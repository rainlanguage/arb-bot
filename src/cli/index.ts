import { Context, Tracer } from "@opentelemetry/api";

export type OtelTracer = {
    tracer?: Tracer;
    ctx?: Context;
};
