"use strict";

/**
 * Database packages that should only be imported in store/db files.
 */
const DB_PACKAGES = [
  "firebase-admin/firestore",
  "@google-cloud/firestore",
  "pg",
  "mysql2",
  "mongoose",
  "redis",
  "ioredis",
  "@prisma/client",
  "drizzle-orm",
  "@planetscale/database",
  "better-sqlite3",
  "knex",
  "typeorm",
  "sequelize",
];

/**
 * Paths where DB imports are allowed.
 */
function isAllowedPath(filename) {
  return (
    /\/stores\//.test(filename) ||
    /\/lib\/db\./.test(filename) ||
    /\/store\./.test(filename) ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filename) ||
    /\/__tests__\//.test(filename) ||
    /\/test\//.test(filename)
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Database imports must be isolated to stores/ and lib/db.* files — use StoreContract<T> elsewhere",
      category: "Almadar Services",
    },
    messages: {
      dbOutsideStore:
        "Import '{{source}}' is only allowed in stores/ or lib/db.* files. Use StoreContract<T> for database abstraction so databases remain swappable.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    if (isAllowedPath(filename)) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (DB_PACKAGES.some((pkg) => source === pkg || source.startsWith(pkg + "/"))) {
          context.report({
            node,
            messageId: "dbOutsideStore",
            data: { source },
          });
        }
      },
    };
  },
};
