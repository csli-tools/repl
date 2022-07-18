import { diffLines } from "diff";
import { join } from "path";
import { Recoverable, start } from "repl";
import { register, TSError } from "ts-node";
import { createContext } from "vm";
import { executeJavaScriptAsync, isRecoverable } from "./helpers.js";
export class TsRepl {
    typeScriptService;
    debuggingEnabled;
    evalFilename = `[eval].ts`;
    evalPath;
    evalData = { input: "", output: "" };
    resetToZero; // Bookmark to empty TS input
    initialTypeScript;
    context;
    constructor(tsconfigPath, initialTypeScript, debuggingEnabled = false, installationDir) {
        this.typeScriptService = register({
            project: tsconfigPath,
            ignoreDiagnostics: [
                "1375",
                "1378", // TS1378: Top-level 'await' expressions are only allowed when the 'module' option is set to 'esnext' or 'system', and the 'target' option is set to 'es2017' or higher.
            ],
        });
        this.debuggingEnabled = debuggingEnabled;
        this.resetToZero = this.appendTypeScriptInput("");
        this.initialTypeScript = initialTypeScript;
        this.evalPath = join(installationDir || process.cwd(), this.evalFilename);
    }
    async start() {
        /**
         * A wrapper around replEval used to match the method signature
         * for "Custom Evaluation Functions"
         * https://nodejs.org/api/repl.html#repl_custom_evaluation_functions
         */
        const replEvalWrapper = async (code, _context, _filename, callback) => {
            const result = await this.replEval(code);
            callback(result.error, result.result);
        };
        const csliCompleter = async (linePartial, callback) => {
            const completions = [
              'height()',
              'upload()',
              'init()',
            ]
            const hits = completions.filter((c) => c.startsWith(linePartial) === true);
            // Unsure how this could possibly fail so throwing null for error
            callback(null, [hits, linePartial]);
        };
        const repl = start({
            prompt: "",
            input: process.stdin,
            output: process.stdout,
            terminal: process.stdout.isTTY,
            completer: csliCompleter,
            eval: replEvalWrapper,
            useGlobal: false,
        });
        // Prepare context for TypeScript: TypeScript compiler expects the exports shortcut
        // to exist in `Object.defineProperty(exports, "__esModule", { value: true });`
        const unsafeReplContext = repl.context;
        if (!unsafeReplContext.exports) {
            unsafeReplContext.exports = unsafeReplContext.module.exports;
        }
        // REPL context is created with a default set of module resolution paths,
        // like for example
        // [ '/home/me/repl/node_modules',
        //   '/home/me/node_modules',
        //   '/home/node_modules',
        //   '/node_modules',
        //   '/home/me/.node_modules',
        //   '/home/me/.node_libraries',
        //   '/usr/lib/nodejs' ]
        // However, this does not include the installation path of @cosmjs/cli because
        // REPL does not inherit module paths from the current process. Thus we override
        // the repl paths with the current process' paths
        // unsafeReplContext.module.paths = module.paths;
        this.context = createContext(repl.context);
        const reset = async () => {
            this.resetToZero();
            // Ensure code ends with "\n" due to implementation of replEval
            await this.compileAndExecute(this.initialTypeScript + "\n", false);
        };
        await reset();
        repl.on("reset", reset);
        repl.defineCommand("type", {
            help: "Check the type of a TypeScript identifier",
            action: (identifier) => {
                if (!identifier) {
                    repl.displayPrompt();
                    return;
                }
                const identifierTypeScriptCode = `${identifier}\n`;
                const undo = this.appendTypeScriptInput(identifierTypeScriptCode);
                const identifierFirstPosition = this.evalData.input.length - identifierTypeScriptCode.length;
                const { name, comment } = this.typeScriptService.getTypeInfo(this.evalData.input, this.evalPath, identifierFirstPosition);
                undo();
                repl.outputStream.write(`${name}\n${comment ? `${comment}\n` : ""}`);
                repl.displayPrompt();
            },
        });
        return repl;
    }
    async compileAndExecute(tsInput, isAutocompletionRequest) {
        if (!isAutocompletionRequest) {
            // Expect POSIX lines (https://stackoverflow.com/a/729795)
            if (tsInput.length > 0 && !tsInput.endsWith("\n")) {
                throw new Error("final newline missing");
            }
        }
        const undo = this.appendTypeScriptInput(tsInput);
        let output;
        try {
            // lineOffset unused at the moment (https://github.com/TypeStrong/ts-node/issues/661)
            output = this.typeScriptService.compile(this.evalData.input, this.evalPath);
        }
        catch (err) {
            undo();
            throw err;
        }
        // Use `diff` to check for new JavaScript to execute.
        const changes = diffLines(this.evalData.output, output);
        if (isAutocompletionRequest) {
            undo();
        }
        else {
            this.evalData.output = output;
        }
        // Execute new JavaScript. This may not necessarily be at the end only because e.g. an import
        // statement in TypeScript is compiled to no JavaScript until the imported symbol is used
        // somewhere. This btw. leads to a different execution order of imports than in the TS source.
        let lastResult;
        for (const added of changes.filter((change) => change.added)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            lastResult = await executeJavaScriptAsync(added.value, this.evalFilename, this.context);
        }
        return lastResult;
    }
    /**
     * Add user-friendly error handling around compileAndExecute
     */
    async replEval(code) {
        // TODO: Figure out how to handle completion here.
        if (code === ".scope") {
            return {
                result: undefined,
                error: null,
            };
        }
        const isAutocompletionRequest = !/\n$/.test(code);
        try {
            const result = await this.compileAndExecute(code, isAutocompletionRequest);
            return {
                result: result,
                error: null,
            };
        }
        catch (error) {
            if (this.debuggingEnabled) {
                console.info("Current REPL TypeScript program:");
                console.info(this.evalData.input);
            }
            let outError;
            if (error instanceof TSError) {
                // Support recoverable compilations using >= node 6.
                if (Recoverable && isRecoverable(error)) {
                    outError = new Recoverable(error);
                }
                else {
                    console.error(error.diagnosticText);
                    outError = null;
                }
            }
            else {
                outError = error;
            }
            return {
                result: undefined,
                error: outError,
            };
        }
    }
    appendTypeScriptInput(input) {
        const oldInput = this.evalData.input;
        const oldOutput = this.evalData.output;
        // Handle ASI issues with TypeScript re-evaluation.
        if (oldInput.charAt(oldInput.length - 1) === "\n" && /^\s*[[(`]/.test(input) && !/;\s*$/.test(oldInput)) {
            this.evalData.input = `${this.evalData.input.slice(0, -1)};\n`;
        }
        this.evalData.input += input;
        const undoFunction = () => {
            this.evalData.input = oldInput;
            this.evalData.output = oldOutput;
        };
        return undoFunction;
    }
}
