/// <reference path="../types/npmext.d.ts" />

import yaml from 'yaml';
import fs from 'fs';
import log from 'npmlog';
import path from 'path';
import Module from 'module';
type RequireFunction = ((path:string) => any) & {
    resolve: ((request:string, options?:{paths?: string[]}) => string) & {
        paths(request:string): string[] | null;
    };
};

type ALEX_T = [string, (str:string) => any];
type AutoloadEntry = {
    basePath: string,
    module: string,
    func?: string,
    required?: boolean,
};

const AUTOLOAD_BASENAME = "npm-autoload.";
const AUTOLOAD_EXTENSIONS: ALEX_T[] = [
    ["yaml", yaml.parse],
    ["yml", yaml.parse],
    ["json", JSON.parse],
];

log.heading = "npm-autoloader";

if (process.env.DEBUG_NPM_AUTOLOADER) {
    log.level = 'verbose';
}

function loadConfig(baseDir: string, cfgPrefix?: string): AutoloadEntry[] | null {
    // We're using synchronous calls here. I don't like it, but we
    // have to make sure that we get called before npm continues its work.
    if (!cfgPrefix) {
        cfgPrefix = baseDir + "/";
    }
    for (let [ext, parser] of AUTOLOAD_EXTENSIONS) {
        let cfgPath = cfgPrefix + AUTOLOAD_BASENAME + ext;
        if (fs.existsSync(cfgPath)) {
            try {
                let data = fs.readFileSync(cfgPath, {encoding: "UTF-8"});
                let config = parser(data);
                if (!(config instanceof Array)) {
                    log.error("loadConfig", "expecting array at top-level of %s", cfgPrefix);
                    return null;
                }
                const parsed:AutoloadEntry[] = [];
                for (let cfgEntry of config) {
                    if (typeof cfgEntry === "string") {
                        let required = false;
                        if (cfgEntry[0] == '+') {
                            required = true;
                            cfgEntry = cfgEntry.slice(1);
                        }
                        let [mod, func] = cfgEntry.split(':', 2);
                        let alEntry:AutoloadEntry = {
                            basePath: cfgPath,
                            module: mod,
                            func: func,
                            required: required,
                        };
                        parsed.push(alEntry);
                    } else if (typeof cfgEntry === "object" && cfgEntry.module) {
                        let alEntry:AutoloadEntry = Object.assign({
                            basePath: cfgPath,
                        }, cfgEntry);
                        parsed.push(alEntry);
                    } else {
                        log.warn("loadConfig", "Unexpected entry %j in file %s, ignoring", cfgEntry, cfgPath);
                    }
                }
                return parsed;
            } catch (e) {
                log.error("loadConfig", "Could not parse %s file %s: %s", ext, cfgPath, e);
                return null;
            }
        }
    }
    return null;
}

export abstract class NPMExtensionCommand extends Function implements NPM.CommandFunction {

    readonly __self__:this;
    usage?:string;
    help?:string;

    constructor(protected readonly npm:NPM.Static) {
        super('...args', 'return this.__self__.__call__(...args)');
        const self:this = this.bind(this);
        this.__self__ = self;
        (<any>self).npm = npm;
        return self;
    }

    __call__(args:string[], cb:(err?:any)=>void):void {
        let result;
        try {
            result = this.execute(args);
        } catch (e) {
            cb(e);
            return;
        }
        cb(result);
    }

    abstract execute(args:string[]):any;
}
export interface NPMExtensionCommand {
    (args:string[], cb:(err?:any)=>void):void;
}

class NoopCmd extends NPMExtensionCommand {
    execute():any {}

    usage = "npm noop\n(does nothing)";
    help = "noop: does nothing";
}

class AutoloadCmd extends NPMExtensionCommand {
    execute():any {
        log.info("autoload", "In autoload");
    }
}


function autoload(npm: NPM.Static | null, projectDir: string | null, globalDir?: string):void {
    let alEntries:AutoloadEntry[] = [];
    let npmOrigCommands:string[] = [];
    let npmCommand:string = "";

    if (npm) {
        npmOrigCommands = Object.keys(npm.commands);
        npm.commands["noop"] = new NoopCmd(npm);
        npm.commands["autoload"] = new AutoloadCmd(npm);
        if (npm.command == 'help' && typeof npm.argv[0] == "undefined" && npm.argv[1]) {
            npmCommand = npm.argv[1];
        } else {
            npmCommand = npm.command;
        }
    }

    if (projectDir) {
        alEntries = alEntries.concat(loadConfig(projectDir) || []);
    }
    if (globalDir) {
        alEntries = alEntries.concat(loadConfig(globalDir) || []);
    }

    for (let alEntry of alEntries) {
        let requireFunc:RequireFunction = Module.createRequireFromPath(alEntry.basePath) as RequireFunction;
        let requirePath:string|undefined;
        let importMod:any;
        let imported:boolean = false;
        try {
            requirePath = requireFunc.resolve(alEntry.module);
            importMod = requireFunc(requirePath);
            imported = true;
            if (alEntry.func == null && '_npm_autoload' in importMod && typeof importMod._npm_autoload == 'function') {
                alEntry.func = '_npm_autoload';
            }
            if (alEntry.func) {
                importMod[alEntry.func](npm, npmCommand);
            }
        } catch (e) {
            let errMsg:[string, ...string[]];
            if (requirePath === undefined) {
                errMsg = ["Could not find module %s", alEntry.module];
            } else if (!imported) {
                errMsg = ["Error importing module %s", requirePath];
            } else if (alEntry.func) {
                errMsg = ["Error executing function %s in module %s", alEntry.func, requirePath];
            } else {
                errMsg = ["Unknown error handling autoload entry"];
            }
            if (alEntry.required) {
                log.error("autoload:"+alEntry.basePath, ...errMsg);
                log.error("autoload:"+alEntry.basePath, "Module %s is marked as required, bailing", alEntry.module);
                process.exit(1);
            } else {
                log.warn("autoload:"+alEntry.basePath, ...errMsg);
            }
        }
    }

    if (npm) {
        const cmdLists:Module[] = Object.entries(require.cache as {[path:string]:Module})
                              .filter(([path,_]) => (path.endsWith("npm/lib/config/cmd-list.js")))
                              .map(([_,mod]) => (mod));
        const newCmds = Object.keys(npm.commands).filter((c)=>(npmOrigCommands.indexOf(c) === -1));
        for (let listMod of cmdLists) {
            listMod.exports.cmdList.push(...newCmds);
        }
        npm.fullList.push(...newCmds);
        const builtinDeref = npm.deref;
        npm.deref = (command:string) => (newCmds.includes(command) ? command : builtinDeref(command));
        if (npm.command == 'help' && newCmds.indexOf(npm.argv[0] || npm.argv[1]) !== -1) {
            log.verbose("autoload", "extcmd handling for %s", npm.argv[0]);
            // extension command!
            if (npm.argv[0] === undefined) {
                // npm extcommand or npm extcommand -h
                if (process.argv.indexOf('-h') !== -1) {
                    npm.argv.splice(0,1);
                } else {
                    npm.command = npm.argv[1];
                    npm.argv.splice(0,2);
                }
            } else {
                // npm help extcommand
                const cmd = npm.commands[npm.argv[0]];
                if (cmd.help) {
                    cmd.usage = cmd.help;
                    npm.config.sources.cli.data.usage = true;
                }
            }
        }
    }
}

function onload(npm: NPM.Static):void {
    const globalDir = path.join(npm.config.globalPrefix, "etc");
    if (npm.config.get("global")) {
        autoload(npm, null, globalDir);
    } else {
    }
    autoload(npm, npm.config.get("global") ? null : npm.config.localPrefix, globalDir);
}

export interface NPMModule extends NodeModule {
    exports: NPM.Static;
}
export interface ModuleCalledFromNPM extends NodeModule {
    parent: NPMModule;
}
export function calledFromNPM(module:NodeModule):module is ModuleCalledFromNPM {
    return !!(module.parent && module.parent.id.endsWith('/npm.js'));
}

export function getNPM(module:ModuleCalledFromNPM):NPM.Static;
export function getNPM(module:NodeModule):NPM.Static | null;
export function getNPM(module:NodeModule):NPM.Static | null {
    if (!calledFromNPM(module)) return null;
    return module.parent.exports;
}

export function npmExit(code:number=0):never {
    for (const listener of process.listeners('exit')) {
        if (listener.toString().includes("cb() never called")) {
            process.removeListener('exit', listener);
        }
    }
    return process.exit(code);
}

if (calledFromNPM(module) && !process.env.SKIP_NPM_AUTOLOADER) {
    log.verbose("(load)", "Loaded from onload, running autoload");
    onload(getNPM(module));
} else {
    log.verbose("(load)", "Not loaded from onload, leaving");
}