// import { BaseError, Prettify } from "viem";
// import { PreAssembledSpan } from "../logger";
// import { version as VERSION } from "../../package.json";

// /** Extra arguments and configurations for RainSolverError */
// export type RainSolverErrorConfig = {
//     details?: string;
//     report?: PreAssembledSpan;
//     metaMessages?: string[];
// };

// export type RainSolverErrorType = RainSolverError & { name: "RainSolverError" };
// export class RainSolverError extends Error {
//     readonly version = VERSION;

//     shortMessage: string;

//     details?: string;
//     report?: PreAssembledSpan;
//     metaMessages?: string[] | undefined;

//     override name = "RainSolverError";

//     constructor(shortMessage: string, args?: RainSolverErrorConfig) {
//         const message = [
//             shortMessage || "An error occurred.",
//             "",
//             ...(args?.metaMessages ? [...args.metaMessages, ""] : []),
//             ...(args?.details ? [`Details: ${args.details}`] : []),
//             ...[`Version: ${VERSION}`],
//         ].join("\n");

//         super(message);

//         this.details = args?.details;
//         this.metaMessages = args?.metaMessages;
//         this.shortMessage = shortMessage;
//     }
//     snapshot(): string {
//         return "";
//     }
// }
