import { Script } from "vm";
// @ts-ignore
import { wrapInAsyncFunction } from "./async.js";
export function executeJavaScript(code, filename, context) {
    const script = new Script(code, { filename: filename });
    return script.runInContext(context);
}
export async function executeJavaScriptAsync(code, filename, context) {
    const preparedCode = code.replace(/^\s*"use strict";/, "");
    // wrapped code returns a promise when executed
    const wrappedCode = wrapInAsyncFunction(preparedCode);
    const script = new Script(wrappedCode, { filename: filename });
    const out = await script.runInContext(context);
    return out;
}
export function isRecoverable(error) {
    const recoveryCodes = new Set([
        1003,
        1005,
        1109,
        1126,
        1160,
        1161,
        2355, // "A function whose declared type is neither 'void' nor 'any' must return a value."
    ]);
    return error.diagnosticCodes.every((code) => recoveryCodes.has(code));
}
