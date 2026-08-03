# Debugging these nodes

Press **F5** and pick **Run Node-RED**. That starts your real Node-RED — real flows, real credentials, a
real logged-in session — with this working tree loaded, so a breakpoint anywhere under
`telegrambot/nodes/` or `telegrambot/lib/` is hit. The editor is on <http://localhost:1880> as usual.

## The link is what makes it work

Node-RED loads whatever is in its user directory's `node_modules`. Without a link that is the **published**
package, and breakpoints here are never hit — the running code is a different copy.

```bash
cd d:/HeinzSeinz/Github/node-red-node-telegrambot
npm link

cd ~/.node-red
npm link node-red-node-telegrambot
```

Check it took:

```bash
node -e "console.log(require('fs').realpathSync(process.env.USERPROFILE + '/.node-red/node_modules/node-red-node-telegrambot'))"
```

It must print this repository's path. Two things to know:

- **`~/.node-red/package.json` still says `"node-red-node-telegrambot": "~0.1.6"`.** `npm link` does not
  change it, so a later `npm install` in that directory silently replaces the link with the published
  version again. If breakpoints stop working, check the link first.
- Undo it deliberately with `npm unlink node-red-node-telegrambot && npm install node-red-node-telegrambot`.

## What linking did to your installation

It replaced an installed **0.1.6** with this tree — five minor versions forward. Node type names are
unchanged, so existing flows keep loading, and three node types are new. Two manual steps may apply on that
upgrade: the bot token, and the proxy password. See [MIGRATION.md](../MIGRATION.md).

## Why the link and not `nodesDir`

`nodesDir` also loads the nodes from source and breakpoints work — but **only a module gets its
`examples/` directory scanned.** Node-RED's registry sets `result.examples` in `getModuleNodeFiles`, which
is reached for packages found in `node_modules`; the `nodesDir` path goes through `getLocalNodeFiles` and
never looks. So with `nodesDir` the eight flows under `examples/` are missing from **Import → Examples**.

The link also means the module is loaded by the same path a published install uses, so the debug environment
matches production.

To tell which one you actually got, ask the admin API — **not** the log. The entry point writes its own
version line on load, so that appears either way and proves nothing:

```bash
curl -s -H "Accept: application/json" http://127.0.0.1:1880/nodes | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).filter(m=>(m.types||[]).some(t=>t.startsWith('telegram client'))).map(m=>m.id)))"
```

`node-red-node-telegrambot/telegrambot` is the module path, from the link. `node-red/telegrambot` would mean
it came from `nodesDir` — and then the examples are missing.

Check the examples are really there:

```bash
curl -s -H "Accept: application/json" http://127.0.0.1:1880/library/examples/flows/node-red-node-telegrambot
```

Eight entries, from `Api.account.CheckUsername` to `UploadFile`.

<details>
<summary>The zero-setup variant, if you ever want it</summary>

Pointing `nodesDir` at the **repository root** rather than at `telegrambot/` also works: Node-RED sees a
`package.json` with a `node-red` section, treats the directory as a module, and scans `examples/` after all
(`scanDirForNodesModules`). No link, no setup step — but the module path still differs from production, so
the link is the better default.

</details>

## Why the global Node-RED and not the devDependency

The launch config runs `%APPDATA%/npm/node_modules/node-red/red.js`, not this repo's
`node_modules/node-red`:

```text
$ node node_modules/node-red/red.js
Unsupported version of Node.js: v20.19.3
Node-RED requires Node.js v22.9 or later
```

The devDependency is **node-red 5**, which needs Node 22.9; the Node in PATH is 20. The globally installed
**3.1.9** declares `engines: >=14` and starts fine, and this package supports Node-RED `>=1.3.7`, so it is
a good host for debugging.

This only affects _running_ Node-RED. The test suite uses node-red 5 as a library through
`node-red-node-test-helper` and is fine on Node 20 — CI proves it on both 20 and 22. Once you move to Node
22, point `program` at `${workspaceFolder}/node_modules/node-red/red.js`.

Note the two global npm locations on this machine: `npm root -g` is
`C:\Program Files\nodejs\node_modules` (where `npm link` puts the symlink), while node-red 3.1.9 lives under
`%APPDATA%\npm\node_modules`. Both are real; do not assume one from the other.

## Breaking during startup

The config passes `--inspect`. For something that happens before the editor is up — node registration, the
config node's constructor, a `require` that throws — swap the commented line in `launch.json`:

```jsonc
// "runtimeArgs": ["--inspect=0.0.0.0"],
"runtimeArgs": ["--inspect-brk"],
```

`--inspect-brk` holds on the first line until the debugger attaches.
