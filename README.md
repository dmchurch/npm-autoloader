# npm-autoloader

This provides extensible autoloading scripts to customize `npm`'s behavior in the context of a given package – for example, to support alternative formats for the `package.json` file. This is a more flexible alternative to using `npm`'s `onload-script` configuration variable.

## Install

It's highly recommended to install `npm-autoloader` globally (either systemwide or somewhere else your `$NODE_PATH` will find it), due to the implementation of `onload-script`. You also need to set the `onload-script` config variable to point to the installation, though the config setting can be local instead of global.

```bash
npm install npm-autoloader --global
npm config set onload-script npm-autoloader --global
```

If you don't want to (or can't) install `npm-autoloader` globally, you can instead list the full, absolute path to the `dist/index.js` file:

```bash
npm install npm-autoloader
npm config set onload-script `node -e 'console.log(require.resolve("npm-autoloader"))'`
```

## Use

`npm-autoloader` will look for one of the following files in your project root directory and/or your global configuration directory (whichever directory holds the `npmrc` file that you can edit with `npm config edit --global`):

* `npm-autoload.yaml`
* `npm-autoload.yml`
* `npm-autoload.json`

This file should contain a list of autoload entries in either short or long format, containing the following options:

**module** (string, required)
: the name of the module to load, in the same format expected by the `require()` function. Relative paths, which should start with `.` or `..`, as well as module resolution, behave as though the configuration file itself contained the `require()` statement.

**func** (string, optional)
: the name of a function to call in the module. It will be passed an instance of the `npm` object, which can be queried for things like the command name. If the module exports a function called `_npm_autoload`, it will be used as a default when this is not specified.

**required** (boolean, optional)
: whether this autoload entry must succeed for `npm` to be allowed to run. Ignored during initial `npm install`.

The short format is a string with the syntax `[+]module[:func]`, where the **required** option is represented by a leading `+`.

During the initial `npm install` of a project (as determined by no existing `node_modules/` directory and an `npm install` command line with no additional non-option arguments), `npm-autoloader` will silence any load errors from that project's `npm-autoload.*` configuration file and will not abort if the module was required, to allow for the initial dependency installation.

### `npm-autoload.yaml` example

```yaml
- package-yaml
- module: console
  func: log
  required: true
- +process:exit
```

### `npm-autoload.json` example

```json
[
    "package-yaml",
    {
        "module": "console",
        "func": "log",
        "required": true,
    },
    "+process:exit"
]
```

## Environment variables

* `$DEBUG_NPM_AUTOLOADER` - if present, output various debugging info.
* `$SKIP_NPM_AUTOLOADER` - if present, do not do any autoload. Useful as `SKIP_NPM_AUTOLOADER=1 npm install`.
