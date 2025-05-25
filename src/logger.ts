import { sleep } from "./utils";
import { Resource } from "@opentelemetry/resources";
import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
    BasicTracerProvider,
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
    Span,
    diag,
    trace,
    Tracer,
    context,
    Context,
    TimeInput,
    Exception,
    SpanStatus,
    Attributes,
    SpanOptions,
    DiagLogLevel,
    DiagConsoleLogger,
} from "@opentelemetry/api";

/**
 * Represents a container for an OpenTelemetry span and its associated context.
 * This class is useful for passing both the span and its context together, which
 * is often required when working with OpenTelemetry tracing APIs.
 */
export type SpanWithContext = {
    readonly span: Span;
    readonly context: Context;
};

/**
 * Represents a pre-assembled OpenTelemetry span, encapsulating all relevant span data
 * including name, timing, status, attributes, events, exceptions, and nested spans.
 * This type allows span information to be collected and stored independently of inline
 * instrumentation for app's functions, enabling deferred export to an otel channel at
 * any point during runtime.
 * That means we wont need to use otel API and functionalities directly in a function's
 * body to instrument it, but rather we just gather these data and info and just export
 * it to otel whenever we want
 */
export type PreAssembledSpan = {
    /** Span's name */
    name: string;
    /** Initial span optioins */
    options?: Omit<SpanOptions, "startTime">;
    /** A manually specified start time for this span */
    startTime?: TimeInput;
    /** A manually specified end time for this span */
    endTime?: TimeInput;
    /** The status of this span */
    status?: SpanStatus;
    /** Attributes associated with this span */
    attributes?: Attributes;
    /** Exception details for this span */
    exception?: {
        error: Exception;
        /** A manually specified time for the exception occurrence */
        time?: TimeInput;
    };
    /** Recorded events for this span */
    events?: {
        /** The name of the event */
        name: string;
        /** The attributes that will be added and are associated with this event */
        attributes?: Attributes;
        /** Start time of the event */
        startTime?: TimeInput;
    }[];
    /** Child span of this span */
    child?: PreAssembledSpan;
};

/**
 * RainSolverLogger sets up OpenTelemetry tracing for the RainSolver service.
 *
 * This class configures a tracer provider with either a remote OTLP exporter
 * or a console exporter for local development. It exposes a method to start
 * new spans for tracing operations within the application.
 *
 * @remarks
 * - Uses OpenTelemetry SDK for Node.js.
 * - Supports exporting traces to HyperDX if the API key is provided.
 * - Automatically configures the service name from the `TRACER_SERVICE_NAME`
 * environment variable or defaults to "rain-solver".
 */
export class RainSolverLogger {
    tracer: Tracer;
    exporter: OTLPTraceExporter | ConsoleSpanExporter;

    constructor() {
        // enable diag
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: process?.env?.TRACER_SERVICE_NAME ?? "rain-solver",
            }),
        });

        if (process.env.HYPERDX_API_KEY) {
            const exporter = new OTLPTraceExporter({
                url: "https://in-otel.hyperdx.io/v1/traces",
                headers: {
                    authorization: process?.env?.HYPERDX_API_KEY,
                },
                compression: CompressionAlgorithm.GZIP,
            });
            this.exporter = exporter;
            provider.addSpanProcessor(new BatchSpanProcessor(exporter));
        } else {
            const consoleExporter = new ConsoleSpanExporter();
            this.exporter = consoleExporter;
            provider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter));
        }

        // register the tracer
        provider.register();
        this.tracer = provider.getTracer("rain-solver-tracer");
    }

    /**
     * A wrapper for otel startSpan that starts a new otel span that collects scoped
     * data during runtime that makes it easy to work with otel api as part of this class
     * @param name - The span name
     * @param options - Span initial options
     * @param ctx - Context to set this span on
     */
    startSpan(name: string, options?: SpanOptions, ctx?: Context): SpanWithContext {
        return this.setSpanContext(this.tracer.startSpan(name, options, ctx));
    }

    /**
     * A wrapper for otel setSapn which sets the given span on the active context and returns
     * SpanWithContext instance, this makes it easy to work with otel api as part of this class
     * @param span - The span
     */
    setSpanContext(span: Span): SpanWithContext {
        return { span, context: trace.setSpan(context.active(), span) };
    }

    /**
     * Exports a span (and any of its child spans) with all the given pre-assembled data, the
     * pre-assembled span can be exported at any point during teh runtime, which eliminates the
     * need to use otel API and functionalities inline throughout the codebase for instrumentation
     * @param preAssembledSpan - The span data to export.
     * @param ctx - (Optional) The parent context to associate with the new span.
     */
    exportPreAssembledSpan(preAssembledSpan: PreAssembledSpan, ctx?: Context) {
        const { name, options, startTime, endTime, status, attributes, events, exception, child } =
            preAssembledSpan;

        // start the span
        const { span, context: spanCtx } = this.startSpan(name, { ...options, startTime }, ctx);

        // handle child span if exists
        if (child) {
            this.exportPreAssembledSpan(child, spanCtx);
        }

        // handle attrs
        if (attributes) {
            span.setAttributes(attributes);
        }
        // handle events
        if (events) {
            for (const event of events) {
                span.addEvent(event.name, event.attributes, event.startTime);
            }
        }
        // handle exception
        if (exception) {
            span.recordException(exception.error, exception.time);
        }
        // handle span status
        if (status) {
            span.setStatus(status);
        }
        // end the span with the given end time
        span.end(endTime);
    }

    /**
     * Closes the OTEL exporter connection.
     * This is not generally needed, it is just for graceful connection close
     */
    async shutdown() {
        // flush and close the connection
        await this.exporter.shutdown();
        await sleep(10000);
    }
}
