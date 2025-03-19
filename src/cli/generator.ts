import { generatorHandler } from "@prisma/generator-helper";

import { generate } from "./procedure-generator";

generatorHandler({
    onManifest: () => ({
        defaultOutput: "./procedures",
        prettyName: "Client Procedures",
    }),
    onGenerate: generate,
})