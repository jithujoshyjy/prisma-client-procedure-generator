import { GeneratorOptions } from "@prisma/generator-helper"
import { parseEnvValue } from "@prisma/internals"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const outDir = "./node_modules/.prisma/client"
const outDir2 = "./node_modules/@prisma/client"

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
}

const validTypes = new Set([
    "Int", "BigInt", "Float",
    "Boolean", "String", "DateTime",
    "Json", "Bytes", "Decimal"
])

const data = {
    email: "user" + Math.floor(Math.random() * 100_000) + "@gmail.com",
    name: "" + Math.floor(Math.random() * 100_000),
}

const headerCjs = `const{PrismaClient}=require("./index.js");const prisma=new PrismaClient();`
const procedureCjs = `exports.<<name>>=async function(<<args>>){<<init>>return await prisma.$executeRaw<<code>>;}`

const headerMjs = `import{PrismaClient}from"./index.js";const prisma=new PrismaClient();`
const procedureMjs = `export async function <<name>>(<<args>>){<<init>>return await prisma.$executeRaw<<code>>;}`
const procInit = `const[<<vars>>]=[<<values>>];`

const dtsHeader = `import * as runtime from "@prisma/client/runtime/library";`
const dtsProcJSDocType = `/**<<params>>\n */`
const dtsProcTypeDef = `export const <<name>>: (<<params>>) => runtime.PrismaPromise<number>;`

const out2Cjs = `"use strict";module.exports={...require(".prisma/client/procedures")};`
const out2Mjs = `export*from"../../.prisma/client/procedures.mjs";`
const out2Dts = `export*from".prisma/client/procedures";`

export async function generate(options: GeneratorOptions) {
    const { output, config } = options.generator
    const inputDir = parseEnvValue(output!)

    try {
        const outPath = join(process.cwd(), outDir)
        await mkdir(outPath, { recursive: true })

        const inputFilePaths = await readSQLProcedureFilePaths(inputDir)

        const sanitizedProcedures = inputFilePaths
            .map(async file => await readFile(join(inputDir, file), "utf-8")
                .then(parseSqlParams)
                .then(sanitizeSql.bind(null, file.replace(/\.sql$/, '')))
            )

        const templateMjsProcedures = sanitizedProcedures
            .map(async proc => await proc.then(createProcedureMjsTemplate))

        const templateCjsProcedures = sanitizedProcedures
            .map(async proc => await proc.then(createProcedureCjsTemplate))

        const templateDtsProcedures = sanitizedProcedures
            .map(async proc => await proc.then(createProcedureDtsTemplate))

        const templateMjsProcs = await Promise.all(templateMjsProcedures)
        const templateCjsProcs = await Promise.all(templateCjsProcedures)
        const templateDtsProcs = await Promise.all(templateDtsProcedures)

        const procedureMjsFileContent = headerMjs + '\n' + templateMjsProcs.join('\n')
        const procedureCjsFileContent = headerCjs + '\n' + templateCjsProcs.join('\n')
        const procedureDtsFileContent = dtsHeader + '\n' + templateDtsProcs.join('\n')

        await Promise.all([
            writeFile(join(outDir, "procedures.mjs"), procedureMjsFileContent),
            writeFile(join(outDir, "procedures.js"), procedureCjsFileContent),
            writeFile(join(outDir, "procedures.d.ts"), procedureDtsFileContent),
        ])

        await Promise.all([
            writeFile(join(outDir2, "procedures.mjs"), out2Mjs),
            writeFile(join(outDir2, "procedures.js"), out2Cjs),
            writeFile(join(outDir2, "procedures.d.ts"), out2Dts),
        ])

    } catch (e) {
        console.error("Error: unable to write files for Prisma Client Procedures Generator")
        throw e
    }
}

async function readSQLProcedureFilePaths(path: string): Promise<string[]> {
    try {
        const files = await readdir(path, { withFileTypes: true })
        const fileNames = files.filter(x => x.isFile() && x.name.endsWith(".sql")).map(x => x.name)

        const invalidNames = fileNames.filter(x => !isValidIdentifier(x.replace(/\.sql$/, '')))
        if (invalidNames.length)
            throw new Error(`Invalid procedure name(s), expected valid JavaScript identifier(s): ${invalidNames.join(', ')}`)

        return fileNames
    } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code == "ENOENT") return []

        console.error("Error: unable to read files for Prisma Client Procedures Generator")
        throw e
    }
}

function sanitizeSql(fileName: string, query: ReturnType<typeof parseSqlParams>) {
    const { params, remainingSql: sqlCode } = query
    const findIndex = Array.prototype.findIndex
    const every = Array.prototype.every

    const code = sqlCode
        .replace(/\$(\d+)|\?/g, (match, index) => {
            const paramIndex = index
                ? parseInt(index, 10) - 1
                : findIndex.call(params, ([, v]) => !!v)

            if (paramIndex < 0 || paramIndex >= params.size)
                throw new Error(`Unknown positional parameter: $${paramIndex + 1}`)

            return `\${$${paramIndex}}`
        })
        .replace(/:(\w+)/g, (_, key) => {
            const hasParam = every.call(params, ([, v]) => v.alias === key)
            if (!hasParam) throw new Error(`Unknown named parameter: :${key}`)
            return `\${$${key}}`
        })
        .replace(/`/, '\\`')

    return { fileName, params, code: ['`', code, '`'].join('') }
}

function parseSqlParams(sql: string) {
    const paramRegex = /^--\s*@param\s*\{(\w+)\}\s*(\$\d+)(?::([\w\d_]+))?/

    const paramMap = new Map<string, { type: string; alias: string | null }>()

    const lines = sql.split("\n")
    let parsingComments = true, remainingSqlStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim()
        if (trimmedLine === "") continue

        if (!trimmedLine.startsWith("--")) {
            parsingComments = false
            remainingSqlStartIndex = i
            break
        }
        if (!parsingComments) break

        const match = trimmedLine.match(paramRegex)
        if (!match) break

        const [, type, param, alias] = match

        if (!validTypes.has(type)) throw new Error(`Invalid type '${type}' in SQL comment.`)
        paramMap.set(param, { type, alias: alias ?? null })
    }

    const remainingSql = lines.slice(remainingSqlStartIndex).join("\n").trim()
    return { params: paramMap, remainingSql }
}

function isValidIdentifier(str: string): boolean {
    const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/

    return identifierRegex.test(str) && !str.includes("$") && !isKeyword(str)
}

function isKeyword(word: string): boolean {
    const keywords = new Set([
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
        "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof",
        "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
        "while", "with", "yield", "let", "static", "implements", "interface", "package", "private", "protected",
        "public", "await", "as", "async", "from", "get", "of", "set"
    ])
    return keywords.has(word)
}

function createProcedureMjsTemplate(props: { fileName: string, params: ReturnType<typeof parseSqlParams>["params"], code: string }): string {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''))
    const lastArg = pArgs.at(-1)!
    const argMap = new Map(
        Array.from(
            { length: +lastArg[0].replace('$', '') },
            (_, i) => {
                const k = '$' + (i + 1);
                const v = props.params.get(k)?.alias ?? null
                return [k, v ? '$' + v : v] as const
            }
        )
    )

    const posArgs = Array.from(argMap.keys())
    const namedArgs = posArgs.map(x => argMap.get(x) ?? "")
    const posArgStr = posArgs.join(',')

    const initStr = procInit
        .replace(/<<vars>>/, namedArgs.join(','))
        .replace(/<<values>>/, posArgStr)

    return procedureMjs
        .replace(/<<name>>/, props.fileName)
        .replace(/<<args>>/, posArgStr)
        .replace(/<<init>>/, initStr)
        .replace(/<<code>>/, props.code)
}

function createProcedureCjsTemplate(props: { fileName: string, params: ReturnType<typeof parseSqlParams>["params"], code: string }): string {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''))
    const lastArg = pArgs.at(-1)!
    const argMap = new Map(
        Array.from(
            { length: +lastArg[0].replace('$', '') },
            (_, i) => {
                const k = '$' + (i + 1);
                const v = props.params.get(k)?.alias ?? null
                return [k, v ? '$' + v : v] as const
            }
        )
    )

    const posArgs = Array.from(argMap.keys())
    const namedArgs = posArgs.map(x => argMap.get(x) ?? "")
    const posArgStr = posArgs.join(',')

    const initStr = procInit
        .replace(/<<vars>>/, namedArgs.join(','))
        .replace(/<<values>>/, posArgStr)

    return procedureCjs
        .replace(/<<name>>/, props.fileName)
        .replace(/<<args>>/, posArgStr)
        .replace(/<<init>>/, initStr)
        .replace(/<<code>>/, props.code)
}

function createProcedureDtsTemplate(props: { fileName: string, params: ReturnType<typeof parseSqlParams>["params"], code: string }): string {
    const pArgs = Array.from(props.params)
        .sort(([xk], [yk]) => +xk.replace('$', '') - +yk.replace('$', ''))

    const lastArg = pArgs.at(-1)!
    const pairArgs = Array.from(
        { length: +lastArg[0].replace('$', '') },
        (_, i) => {
            const k = '$' + (i + 1);
            const v = props.params.get(k)?.alias ?? null
            const t = props.params.get(k)?.type ?? null
            return [k, v ?? k, t as keyof typeof prismaToJsTypeMap | null] as const
        }
    )

    const jsDocParams = pairArgs
        .map(([k, v]) => `\n * @param ${k === v ? k : v}`)

    const dtsParams = pairArgs
        .map(([k, v, t]) => `${k === v ? k : v}: ${!t ? "unknown" : prismaToJsTypeMap[t] ?? "unknown"}`)

    const jsDocParamsStr = dtsProcJSDocType
        .replace(/<<params>>/, jsDocParams.join(''))

    const dtsParamsStr = dtsProcTypeDef
        .replace(/<<name>>/, props.fileName)
        .replace(/<<params>>/, dtsParams.join(', '))


    return jsDocParamsStr + '\n' + dtsParamsStr
}
