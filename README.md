<h1 align="center">prisma-client-procedure-generator</h1>

<p align="center">
Automatically generate functions to execute SQL code from .sql files using <a href="https://github.com/prisma/prisma">Prisma</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/prisma-client-procedure-generator" target="_blank" rel="noopener">
    <img src="https://img.shields.io/npm/dt/prisma-client-procedure-generator.svg" alt="Total Downloads" />
  </a>
  <a href="https://www.npmjs.com/package/prisma-client-procedure-generator" target="_blank" rel="noopener">
    <img src="https://img.shields.io/npm/v/prisma-client-procedure-generator.svg" alt="npm package"/>
  </a>
  <a href="https://github.com/jithujoshyjy/prisma-client-procedure-generator/blob/main/LICENSE" target="_blank" rel="noopener">
    <img src="https://img.shields.io/npm/l/prisma-client-procedure-generator.svg" alt="License">
  </a>
</p>

Updates every time `npx prisma generate` runs.

## Getting started

> The example sql code used here is for sqlite

1. Install this generator:

```bash
npm install -D prisma-client-procedure-generator
```

2. Add the generator to the `schema.prisma`

```prisma
generator procedures {
  provider = "prisma-client-procedure-generator"
}
```

3. Running `npx prisma generate` to generate a function from the following .sql file located at `/prisma/procedures/createUser.sql`

```sql
-- @param {String} $1:name The name of the user
-- @param {String} $2:email The email id of the user

INSERT INTO "user" ("name", "email")
VALUES (:name, :email)
```

generates the following function that can be imported from `@prisma/client/procedures`

```javascript
import { Prisma } from "./index.js";

export async function createUser($1, $2) {
    const[$name, $email] = [$1, $2];
    return await Prisma.sql`
        INSERT INTO user ("name", email) VALUES (${$name}, ${$email})
    `;
}
```

4. Import and use the function to execute custom sql code

The following example shows the usage in a NextJS server action

```javascript
"use server"
import { PrismaClient } from "@prisma/client"
import { createUser } from "@prisma/client/procedures"

const prisma = new PrismaClient()

export async function createUserAction(formData: FormData) {
    const name = formData.get("name")
    const email = formData.get("email")
    
    await prisma.$executeRaw(createUser(name, email))
}
```