#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';

import copy from 'esbuild-plugin-copy';

import { cleanPlugin } from './pkg/lib/esbuild-cleanup-plugin.js';
import { cockpitCompressPlugin } from './pkg/lib/esbuild-compress-plugin.js';
import { cockpitPoEsbuildPlugin } from './pkg/lib/cockpit-po-plugin.js';
import { cockpitRsyncEsbuildPlugin } from './pkg/lib/cockpit-rsync-plugin.js';
import { esbuildStylesPlugins } from './pkg/lib/esbuild-common.js';

const production = process.env.NODE_ENV === 'production';
const useWasm = os.arch() !== 'x64';
const esbuild = (await import(useWasm ? 'esbuild-wasm' : 'esbuild')).default;

const parser = (await import('argparse')).default.ArgumentParser();
parser.add_argument('-r', '--rsync', { help: "rsync bundles to ssh target after build", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable watch mode", default: process.env.ESBUILD_WATCH === "true" });
parser.add_argument('-m', '--metafile', { help: "Enable bundle size information file", metavar: "FILE" });
const args = parser.parse_args();

if (args.rsync)
    process.env.RSYNC = args.rsync;

// List of directories to use when using import statements
const nodePaths = ['pkg/lib'];
const outdir = 'dist';

// Obtain package name from package.json
const packageJson = JSON.parse(fs.readFileSync('package.json'));

function notifyEndPlugin() {
    return {
        name: 'notify-end',
        setup(build) {
            let startTime;

            build.onStart(() => {
                startTime = new Date();
            });

            build.onEnd(() => {
                const endTime = new Date();
                const timeStamp = endTime.toTimeString().split(' ')[0];
                console.log(`${timeStamp}: Build finished in ${endTime - startTime} ms`);
            });
        }
    };
}

// similar to fs.watch(), but recursively watches all subdirectories
function watch_dirs(dir, on_change) {
    const callback = (ev, dir, fname) => {
        // only listen for "change" events, as renames are noisy
        // ignore hidden files
        if (ev !== "change" || fname.startsWith('.')) {
            return;
        }
        on_change(path.join(dir, fname));
    };

    fs.watch(dir, {}, (ev, path) => callback(ev, dir, path));

    // watch all subdirectories in dir
    const d = fs.opendirSync(dir);
    let dirent;

    while ((dirent = d.readSync()) !== null) {
        if (dirent.isDirectory())
            watch_dirs(path.join(dir, dirent.name), on_change);
    }
    d.closeSync();
}

const context = await esbuild.context({
    ...!production ? { sourcemap: "linked" } : {},
    bundle: true,
    entryPoints: ['./src/index.js'],
    external: ['*.woff', '*.woff2', '*.jpg', '*.svg', '../../assets*'], // Allow external font files which live in ../../static/fonts
    legalComments: 'external', // Move all legal comments to a .LEGAL.txt file
    loader: {
        ".js": "jsx",
        ".ttf": "binary"
    },
    metafile: !!args.metafile,
    minify: production,
    nodePaths,
    outdir,
    target: ['es2020'],
    plugins: [
        cleanPlugin(),
        // Esbuild will only copy assets that are explicitly imported and used
        // in the code. This is a problem for index.html and manifest.json which are not imported
        copy({
            assets: [
                { from: ['./src/manifest.json'], to: ['./manifest.json'] },
                { from: ['./src/index.html'], to: ['./index.html'] },
            ]
        }),
        ...esbuildStylesPlugins,
        cockpitPoEsbuildPlugin(),
        ...production ? [cockpitCompressPlugin()] : [],
        cockpitRsyncEsbuildPlugin({ dest: packageJson.name }),
        notifyEndPlugin(),
    ]
});

try {
    const result = await context.rebuild();
    if (args.metafile) {
        fs.writeFileSync(args.metafile, JSON.stringify(result.metafile));
    }
} catch (e) {
    if (!args.watch)
        process.exit(1);
    // ignore errors in watch mode
}

if (args.watch) {
    const on_change = async path => {
        console.log("change detected:", path);
        await context.cancel();

        try {
            await context.rebuild();
        } catch (e) {} // ignore in watch mode
    };

    watch_dirs('src', on_change);

    // wait forever until Control-C
    await new Promise(() => {});
}

context.dispose();
