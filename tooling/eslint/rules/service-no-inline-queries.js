"use strict";

/**
 * @fileoverview Rule to prevent inline Firestore queries in route handlers
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent inline Firestore queries embedded in route handlers",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      inlineFirestore: "Inline Firestore query detected. Extract to DataService or use StoreContract abstraction.",
      directDbAccess: "Direct database access in route handler. Use service layer (DataService) instead.",
      firestoreImport: "Firestore imports should not be used directly in route files. Use service abstraction.",
    },
    schema: [
      {
        type: "object",
        properties: {
          routePatterns: {
            type: "array",
            items: { type: "string" },
            default: ["routes/", "src/routes/", "api/"],
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const routePatterns = options.routePatterns || ["routes/", "src/routes/", "api/"];

    const filename = context.filename;
    
    // Check if this is a route file
    const isRouteFile = routePatterns.some((pattern) => filename.includes(pattern));
    
    // Also check if it looks like a route handler (contains route handler patterns)
    let hasRouteHandlerPattern = false;
    
    return {
      // Check for Firestore imports
      ImportDeclaration(node) {
        const source = node.source.value;
        
        if (source.includes("firebase-admin") || source.includes("@google-cloud/firestore")) {
          if (isRouteFile) {
            context.report({
              node,
              messageId: "firestoreImport",
            });
          }
        }
      },

      // Check for Express route handler patterns
      "CallExpression[callee.object.name='app'][callee.property.name=/^(get|post|put|delete|patch)$/]"(_node) {
        hasRouteHandlerPattern = true;
      },

      "CallExpression[callee.object.name='router'][callee.property.name=/^(get|post|put|delete|patch)$/]"(_node) {
        hasRouteHandlerPattern = true;
      },

      // Check for Firestore method calls
      "CallExpression[callee.type='MemberExpression']"(node) {
        const callee = node.callee;
        
        // Check for db.collection(), doc.get(), etc.
        if (callee.property && callee.property.type === "Identifier") {
          const methodName = callee.property.name;
          
          const firestoreMethods = [
            "collection", "doc", "get", "set", "update", "delete", 
            "where", "orderBy", "limit", "startAfter", "endBefore",
            "add", "batch", "runTransaction"
          ];
          
          if (firestoreMethods.includes(methodName)) {
            // Check if this is being called on a Firestore-like object
            const objectName = callee.object.name || 
                              (callee.object.property && callee.object.property.name);
            
            const firestoreObjectNames = ["db", "firestore", "admin", "firestoreDb", "firebase"];
            
            if (objectName && firestoreObjectNames.some(name => 
              objectName.toLowerCase().includes(name)
            )) {
              if (isRouteFile || hasRouteHandlerPattern) {
                context.report({
                  node,
                  messageId: "inlineFirestore",
                });
              }
            }
          }
        }
      },

      // Check for direct db access patterns
      "MemberExpression[object.name='db']"(node) {
        if (isRouteFile || hasRouteHandlerPattern) {
          context.report({
            node,
            messageId: "directDbAccess",
          });
        }
      },
    };
  },
};
