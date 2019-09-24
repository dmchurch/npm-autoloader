import npmImport from 'npm';
type NPMStaticType = typeof npmImport;
type NPMConfigType = typeof npmImport.config;
type NPMConfigSourceType = typeof npmImport.config.sources._;
type NPMCommandsType = typeof npmImport.commands;
type NPMCommandFunctionType = typeof npmImport.commands.config;

declare global {
    export namespace NPM {
        export interface Static extends NPMStaticType {
            config: Config;

            commands: Commands;

            command: string;
            argv: string[];
        }

        export interface ConfigSource extends NPMConfigSourceType {
            data: any;
        }
        export interface Config extends NPMConfigType {
            localPrefix: string;
            globalPrefix: string;

            sources: {
                [k: string]: ConfigSource;
            }
        }

        export interface CommandFunction extends NPMCommandFunctionType {
            usage?: string;
            help?: string;
        }

        export interface Commands extends NPMCommandsType {
            [key: string]: CommandFunction;
        }
    }
}