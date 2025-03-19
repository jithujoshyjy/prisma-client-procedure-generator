"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate = void 0;
const internals_1 = require("@prisma/internals");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const outDir = "./node_modules/.prisma/client";
const outDir2 = "./node_modules/@prisma/client";
const prismaToJsTypeMap = {
    Int: "number",
    BigInt: "number | bigint",
    Float: "number",
    Boolean: "boolean",
    String: "string",
    DateTime: "Date",
    Decimal: "number | runtime.Decimal",
    Json: "runtime.InputJsonObject",
    Bytes: "Uint8Array"
};
const validTypes = new Set([
    "Int", "BigInt", "Float",
    "Boolean", "String", "DateTime",
    "Json", "Bytes", "Decimal"
]);
const data = {
    email: "user" + Math.floor(Math.random() * 100000) + "@gmail.com",
    name: "" + Math.floor(Math.random() * 100000),
};
const headerCjs = `const{Prisma}=require("./index.js");`;
const procedureCjs = `exports.<<name>>=function(<<args>>){<<init>>return Prisma.sql<<code>>;}`;
const headerMjs = `import{Prisma}from"./index.js";`;
const procedureMjs = `export function <<name>>(<<args>>){<<init>>return Prisma.sql<<code>>;}`;
const procInit = `const[<<vars>>]=[<<values>>];`;
const dtsHeader = `import * as runtime from "@prisma/client/runtime/library";`;
const dtsProcJSDocType = `/**<<params>>\n */`;
const dtsProcTypeDef = `export const <<name>>: (<<params>>) => runtime.PrismaPromise<number>;`;
const out2Cjs = `"use strict";module.exports={...require(".prisma/client/procedures")};`;
const out2Mjs = `export*from"../../.prisma/client/procedures.mjs";`;
const out2Dts = `export*from".prisma/client/procedures";`;
async function generate(options) {
    const { output, config } = options.generator;
    const inputDir = (0, internals_1.parseEnvValue)(output);
    try {
        const outPath = (0, node_path_1.join)(process.cwd(), outDir);
        await (0, promises_1.mkdir)(outPath, { recursive: true });
        const inputFilePaths = await readSQLProcedureFilePaths(inputDir);
        const sanitizedProcedures = inputFilePaths
            .map(async (file) => await (0, promises_1.readFile)((0, node_path_1.join)(inputDir, file), "utf-8")
            .then(parseSqlParams)
            .then(sanitizeSql.bind(null, file.replace(/\.sql$/, ''))));
        const templateMjsProcedures = sanitizedProcedures
            .map(async (proc) => await proc.then(createProcedureMjsTemplate));
        const templateCjsProcedures = sanitizedProcedures
            .map(async (proc) => await proc.then(createProcedureCjsTemplate));
        const templateDtsProcedures = sanitizedProcedures
            .map(async (proc) => await proc.then(createProcedureDtsTemplate));
        const templateMjsProcs = await Promise.all(templateMjsProcedures);
        const templateCjsProcs = await Promise.all(templateCjsProcedures);
        const templateDtsProcs = await Promise.all(templateDtsProcedures);
        const procedureMjsFileContent = headerMjs + '\n' + templateMjsProcs.join('\n');
        const procedureCjsFileContent = headerCjs + '\n' + templateCjsProcs.join('\n');
        const procedureDtsFileContent = dtsHeader + '\n' + templateDtsProcs.join('\n');
        await Promise.all([
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir, "procedures.mjs"), procedureMjsFileContent),
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir, "procedures.js"), procedureCjsFileContent),
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir, "procedures.d.ts"), procedureDtsFileContent),
        ]);
        await Promise.all([
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir2, "procedures.mjs"), out2Mjs),
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir2, "procedures.js"), out2Cjs),
            (0, promises_1.writeFile)((0, node_path_1.join)(outDir2, "procedures.d.ts"), out2Dts),
        ]);
        const outDirPackageJson = await (0, promises_1.readFile)((0, node_path_1.join)(outDir, "package.json"), "utf-8")
            .then(x => JSON.parse(x));
        const outDir2PackageJson = await (0, promises_1.readFile)((0, node_path_1.join)(outDir2, "package.json"), "utf-8")
            .then(x => JSON.parse(x));
        const procedureModule = {
            "require": {
                "types": "./procedures.d.ts",
                "node": "./procedures.js",
                "default": "./procedures.js"
            },
            "import": {
                "types": "./procedures.d.ts",
                "node": "./procedures.mjs",
                "default": "./procedures.mjs"
            },
            "default": "./procedures.js"
        };
        if (outDirPackageJson.exports)
            outDirPackageJson.exports["./procedures"] = procedureModule;
        if (outDir2PackageJson.exports)
            outDir2PackageJson.exports["./procedures"] = procedureModule;
        await (0, promises_1.writeFile)((0, node_path_1.join)(outDir, "package.json"), JSON.stringify(outDirPackageJson, undefined, 4));
        await (0, promises_1.writeFile)((0, node_path_1.join)(outDir2, "package.json"), JSON.stringify(outDir2PackageJson, undefined, 4));
    }
    catch (e) {
        console.error("Error: unable to write files for Prisma Client Procedures Generator");
        throw e;
    }
}
exports.generate = generate;
async function readSQLProcedureFilePaths(path) {
    try {
        const files = await (0, promises_1.readdir)(path, { withFileTypes: true });
        const fileNames = files.filter(x => x.isFile() && x.name.endsWith(".sql")).map(x => x.name);
        const invalidNames = fileNames.filter(x => !isValidIdentifier(x.replace(/\.sql$/, '')));
        if (invalidNames.length)
            throw new Error(`Invalid procedure name(s), expected valid JavaScript identifier(s): ${invalidNames.join(', ')}`);
        return fileNames;
    }
    catch (e) {
        const err = e;
        if (err.code == "ENOENT")
            return [];
        console.error("Error: unable to read files for Prisma Client Procedures Generator");
        throw e;
    }
}
function sanitizeSql(fileName, query) {
    const { params, remainingSql: sqlCode } = query;
    const findIndex = Array.prototype.findIndex;
    const every = Array.prototype.every;
    const code = sqlCode
        .replace(/\$(\d+)|\?/g, (match, index) => {
        const paramIndex = index
            ? parseInt(index, 10) - 1
            : findIndex.call(params, ([, v]) => !!v);
        if (paramIndex < 0 || paramIndex >= params.size)
            throw new Error(`Unknown positional parameter: $${paramIndex + 1}`);
        return `\${$${paramIndex}}`;
    })
        .replace(/:(\w+)/g, (_, key) => {
        const hasParam = every.call(params, ([, v]) => v.alias === key);
        if (!hasParam)
            throw new Error(`Unknown named parameter: :${key}`);
        return `\${$${key}}`;
    })
        .replace(/`/, '\\`');
    return { fileName, params, code: ['`', code, '`'].join('') };
}
function parseSqlParams(sql) {
    const paramRegex = /^--\s*@param\s*\{(\w+)\}\s*(\$\d+)(?::([\w\d_]+))?/;
    const paramMap = new Map();
    const lines = sql.split("\n");
    let parsingComments = true, remainingSqlStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine === "")
            continue;
        if (!trimmedLine.startsWith("--")) {
            parsingComments = false;
            remainingSqlStartIndex = i;
            break;
        }
        if (!parsingComments)
            break;
        const match = trimmedLine.match(paramRegex);
        if (!match)
            break;
        const [, type, param, alias] = match;
        if (!validTypes.has(type))
            throw new Error(`Invalid type '${type}' in SQL comment.`);
        paramMap.set(param, { type, alias: alias !== null && alias !== void 0 ? alias : null });
    }
    const remainingSql = lines.slice(remainingSqlStartIndex).join("\n").trim();
    return { params: paramMap, remainingSql };
}
function isValidIdentifier(str) {
    const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
    return identifierRegex.test(str) && !str.includes("$") && !isKeyword(str);
}
function isKeyword(word) {
    const keywords = new Set([
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
        "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof",
        "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
        "while", "with", "yield", "let", "static", "implements", "interface", "package", "private", "protected",
        "public", "await", "as", "async", "from", "get", "of", "set"
    ]);
    return keywords.has(word);
}
function createProcedureMjsTemplate(props) {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''));
    const lastArg = pArgs.at(-1);
    const argMap = new Map(Array.from({ length: +lastArg[0].replace('$', '') }, (_, i) => {
        var _a, _b;
        const k = '$' + (i + 1);
        const v = (_b = (_a = props.params.get(k)) === null || _a === void 0 ? void 0 : _a.alias) !== null && _b !== void 0 ? _b : null;
        return [k, v ? '$' + v : v];
    }));
    const posArgs = Array.from(argMap.keys());
    const namedArgs = posArgs.map(x => { var _a; return (_a = argMap.get(x)) !== null && _a !== void 0 ? _a : ""; });
    const posArgStr = posArgs.join(',');
    const initStr = procInit
        .replace(/<<vars>>/, namedArgs.join(','))
        .replace(/<<values>>/, posArgStr);
    return procedureMjs
        .replace(/<<name>>/, props.fileName)
        .replace(/<<args>>/, posArgStr)
        .replace(/<<init>>/, initStr)
        .replace(/<<code>>/, props.code);
}
function createProcedureCjsTemplate(props) {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''));
    const lastArg = pArgs.at(-1);
    const argMap = new Map(Array.from({ length: +lastArg[0].replace('$', '') }, (_, i) => {
        var _a, _b;
        const k = '$' + (i + 1);
        const v = (_b = (_a = props.params.get(k)) === null || _a === void 0 ? void 0 : _a.alias) !== null && _b !== void 0 ? _b : null;
        return [k, v ? '$' + v : v];
    }));
    const posArgs = Array.from(argMap.keys());
    const namedArgs = posArgs.map(x => { var _a; return (_a = argMap.get(x)) !== null && _a !== void 0 ? _a : ""; });
    const posArgStr = posArgs.join(',');
    const initStr = procInit
        .replace(/<<vars>>/, namedArgs.join(','))
        .replace(/<<values>>/, posArgStr);
    return procedureCjs
        .replace(/<<name>>/, props.fileName)
        .replace(/<<args>>/, posArgStr)
        .replace(/<<init>>/, initStr)
        .replace(/<<code>>/, props.code);
}
function createProcedureDtsTemplate(props) {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''));
    const lastArg = pArgs.at(-1);
    const pairArgs = Array.from({ length: +lastArg[0].replace('$', '') }, (_, i) => {
        var _a, _b, _c, _d;
        const k = '$' + (i + 1);
        const v = (_b = (_a = props.params.get(k)) === null || _a === void 0 ? void 0 : _a.alias) !== null && _b !== void 0 ? _b : null;
        const t = (_d = (_c = props.params.get(k)) === null || _c === void 0 ? void 0 : _c.type) !== null && _d !== void 0 ? _d : null;
        return [k, v !== null && v !== void 0 ? v : k, t];
    });
    const jsDocParams = pairArgs
        .map(([k, v]) => `\n * @param ${k === v ? k : v}`);
    const dtsParams = pairArgs
        .map(([k, v, t]) => { var _a; return `${k === v ? k : v}: ${!t ? "unknown" : (_a = prismaToJsTypeMap[t]) !== null && _a !== void 0 ? _a : "unknown"}`; });
    const jsDocParamsStr = dtsProcJSDocType
        .replace(/<<params>>/, jsDocParams.join(''));
    const dtsParamsStr = dtsProcTypeDef
        .replace(/<<name>>/, props.fileName)
        .replace(/<<params>>/, dtsParams.join(', '));
    return jsDocParamsStr + '\n' + dtsParamsStr;
}
