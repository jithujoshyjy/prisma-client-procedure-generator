"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generator_helper_1 = require("@prisma/generator-helper");
const procedure_generator_1 = require("./procedure-generator");
(0, generator_helper_1.generatorHandler)({
    onManifest: () => ({
        defaultOutput: "./procedures",
        prettyName: "Client Procedures",
    }),
    onGenerate: procedure_generator_1.generate,
});
