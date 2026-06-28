import { reviewCode } from "@landmark-lore/code-reviewer";

const diff = `\
diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 export function greet(name: string): string {
-  return "Hello " + name
+  return \`Hello, \${name}!\`;
 }
`;

const result = await reviewCode(diff);
console.log(JSON.stringify(result, null, 2));
