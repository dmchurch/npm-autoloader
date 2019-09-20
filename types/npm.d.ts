import npmImport from 'npm';
type NPMStaticType = typeof npmImport;
type NPMConfigType = typeof npmImport.config;

declare global {
    export namespace NPM {
        export interface Static extends NPMStaticType {
            config: Config;
        }
        export interface Config extends NPMConfigType {
            localPrefix: string;
            globalPrefix: string;
        }
    }
}