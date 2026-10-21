/**
 * The syntax highlighter `CodeBlock` paints with: PrismLight, its element builder, the two schemes and every
 * registered grammar. Loaded on demand (`CodeBlock`'s `loadPrism`), so the first-load chunk carries none of it and a
 * block shows its code as plain monospace until it arrives (G-UI-105).
 *
 * @packageDocumentation
 */
// GAP-78: explicit `.js` extensions on every react-syntax-highlighter deep
// import. The package ships ESM files with no `package.json#exports` map and
// no implicit-extension resolution, so Node ESM (used by vitest's externalized
// loader) can't resolve `.../prism-light` without the extension. Vite/dev mode
// handles it via legacy directory resolution but vitest doesn't. Adding the
// extensions here makes both code paths work.
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light.js';
import createHighlightElement from 'react-syntax-highlighter/dist/esm/create-element.js';
import dark from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus.js';
import light from 'react-syntax-highlighter/dist/esm/styles/prism/vs.js';
import { orbLanguage, loloLanguage } from '@almadar/syntax';

// PrismLight requires explicit language registration.
// Import common languages used in markdown code blocks.
import langJson from 'react-syntax-highlighter/dist/esm/languages/prism/json.js';
import langJavascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript.js';
import langTypescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript.js';
import langJsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx.js';
import langTsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx.js';
import langCss from 'react-syntax-highlighter/dist/esm/languages/prism/css.js';
import langMarkdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown.js';
import langBash from 'react-syntax-highlighter/dist/esm/languages/prism/bash.js';
import langYaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml.js';
import langRust from 'react-syntax-highlighter/dist/esm/languages/prism/rust.js';
import langPython from 'react-syntax-highlighter/dist/esm/languages/prism/python.js';
import langSql from 'react-syntax-highlighter/dist/esm/languages/prism/sql.js';
import langDiff from 'react-syntax-highlighter/dist/esm/languages/prism/diff.js';
import langToml from 'react-syntax-highlighter/dist/esm/languages/prism/toml.js';
import langGo from 'react-syntax-highlighter/dist/esm/languages/prism/go.js';
import langGraphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql.js';
// Common languages used in lessons (statically bundled for reliable highlighting;
// the dynamic loader covers the long tail on demand).
import langClojure from 'react-syntax-highlighter/dist/esm/languages/prism/clojure.js';
import langHaskell from 'react-syntax-highlighter/dist/esm/languages/prism/haskell.js';
import langLisp from 'react-syntax-highlighter/dist/esm/languages/prism/lisp.js';
import langScheme from 'react-syntax-highlighter/dist/esm/languages/prism/scheme.js';
import langScala from 'react-syntax-highlighter/dist/esm/languages/prism/scala.js';
import langElixir from 'react-syntax-highlighter/dist/esm/languages/prism/elixir.js';
import langErlang from 'react-syntax-highlighter/dist/esm/languages/prism/erlang.js';
import langElm from 'react-syntax-highlighter/dist/esm/languages/prism/elm.js';
import langFsharp from 'react-syntax-highlighter/dist/esm/languages/prism/fsharp.js';
import langOcaml from 'react-syntax-highlighter/dist/esm/languages/prism/ocaml.js';
import langJava from 'react-syntax-highlighter/dist/esm/languages/prism/java.js';
import langC from 'react-syntax-highlighter/dist/esm/languages/prism/c.js';
import langCpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp.js';
import langCsharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp.js';
import langObjectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec.js';
import langPhp from 'react-syntax-highlighter/dist/esm/languages/prism/php.js';
import langRuby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby.js';
import langSwift from 'react-syntax-highlighter/dist/esm/languages/prism/swift.js';
import langKotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin.js';
import langLua from 'react-syntax-highlighter/dist/esm/languages/prism/lua.js';
import langR from 'react-syntax-highlighter/dist/esm/languages/prism/r.js';
import langDart from 'react-syntax-highlighter/dist/esm/languages/prism/dart.js';
import langJulia from 'react-syntax-highlighter/dist/esm/languages/prism/julia.js';
import langFortran from 'react-syntax-highlighter/dist/esm/languages/prism/fortran.js';
import langPerl from 'react-syntax-highlighter/dist/esm/languages/prism/perl.js';
import langPowershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell.js';
import langMakefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile.js';
import langNginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx.js';
import langIni from 'react-syntax-highlighter/dist/esm/languages/prism/ini.js';
import langClike from 'react-syntax-highlighter/dist/esm/languages/prism/clike.js';

// Register built-in languages
SyntaxHighlighter.registerLanguage('json', langJson);
SyntaxHighlighter.registerLanguage('javascript', langJavascript);
SyntaxHighlighter.registerLanguage('js', langJavascript);
SyntaxHighlighter.registerLanguage('typescript', langTypescript);
SyntaxHighlighter.registerLanguage('ts', langTypescript);
SyntaxHighlighter.registerLanguage('jsx', langJsx);
SyntaxHighlighter.registerLanguage('tsx', langTsx);
SyntaxHighlighter.registerLanguage('css', langCss);
SyntaxHighlighter.registerLanguage('markdown', langMarkdown);
SyntaxHighlighter.registerLanguage('md', langMarkdown);
SyntaxHighlighter.registerLanguage('bash', langBash);
SyntaxHighlighter.registerLanguage('shell', langBash);
SyntaxHighlighter.registerLanguage('sh', langBash);
SyntaxHighlighter.registerLanguage('yaml', langYaml);
SyntaxHighlighter.registerLanguage('yml', langYaml);
SyntaxHighlighter.registerLanguage('rust', langRust);
SyntaxHighlighter.registerLanguage('python', langPython);
SyntaxHighlighter.registerLanguage('py', langPython);
SyntaxHighlighter.registerLanguage('sql', langSql);
SyntaxHighlighter.registerLanguage('diff', langDiff);
SyntaxHighlighter.registerLanguage('toml', langToml);
SyntaxHighlighter.registerLanguage('go', langGo);
SyntaxHighlighter.registerLanguage('graphql', langGraphql);
SyntaxHighlighter.registerLanguage('clojure', langClojure);
SyntaxHighlighter.registerLanguage('clj', langClojure);
SyntaxHighlighter.registerLanguage('edn', langClojure);
SyntaxHighlighter.registerLanguage('haskell', langHaskell);
SyntaxHighlighter.registerLanguage('hs', langHaskell);
SyntaxHighlighter.registerLanguage('lisp', langLisp);
SyntaxHighlighter.registerLanguage('scheme', langScheme);
SyntaxHighlighter.registerLanguage('scala', langScala);
SyntaxHighlighter.registerLanguage('elixir', langElixir);
SyntaxHighlighter.registerLanguage('ex', langElixir);
SyntaxHighlighter.registerLanguage('exs', langElixir);
SyntaxHighlighter.registerLanguage('erlang', langErlang);
SyntaxHighlighter.registerLanguage('erl', langErlang);
SyntaxHighlighter.registerLanguage('elm', langElm);
SyntaxHighlighter.registerLanguage('fsharp', langFsharp);
SyntaxHighlighter.registerLanguage('fs', langFsharp);
SyntaxHighlighter.registerLanguage('fsx', langFsharp);
SyntaxHighlighter.registerLanguage('ocaml', langOcaml);
SyntaxHighlighter.registerLanguage('ml', langOcaml);
SyntaxHighlighter.registerLanguage('java', langJava);
SyntaxHighlighter.registerLanguage('c', langC);
SyntaxHighlighter.registerLanguage('cpp', langCpp);
SyntaxHighlighter.registerLanguage('c++', langCpp);
SyntaxHighlighter.registerLanguage('cc', langCpp);
SyntaxHighlighter.registerLanguage('cxx', langCpp);
SyntaxHighlighter.registerLanguage('hpp', langCpp);
SyntaxHighlighter.registerLanguage('h', langCpp);
SyntaxHighlighter.registerLanguage('csharp', langCsharp);
SyntaxHighlighter.registerLanguage('cs', langCsharp);
SyntaxHighlighter.registerLanguage('objectivec', langObjectivec);
SyntaxHighlighter.registerLanguage('objc', langObjectivec);
SyntaxHighlighter.registerLanguage('php', langPhp);
SyntaxHighlighter.registerLanguage('ruby', langRuby);
SyntaxHighlighter.registerLanguage('rb', langRuby);
SyntaxHighlighter.registerLanguage('swift', langSwift);
SyntaxHighlighter.registerLanguage('kotlin', langKotlin);
SyntaxHighlighter.registerLanguage('kt', langKotlin);
SyntaxHighlighter.registerLanguage('lua', langLua);
SyntaxHighlighter.registerLanguage('r', langR);
SyntaxHighlighter.registerLanguage('dart', langDart);
SyntaxHighlighter.registerLanguage('julia', langJulia);
SyntaxHighlighter.registerLanguage('fortran', langFortran);
SyntaxHighlighter.registerLanguage('f90', langFortran);
SyntaxHighlighter.registerLanguage('f95', langFortran);
SyntaxHighlighter.registerLanguage('perl', langPerl);
SyntaxHighlighter.registerLanguage('pl', langPerl);
SyntaxHighlighter.registerLanguage('powershell', langPowershell);
SyntaxHighlighter.registerLanguage('ps1', langPowershell);
SyntaxHighlighter.registerLanguage('makefile', langMakefile);
SyntaxHighlighter.registerLanguage('make', langMakefile);
SyntaxHighlighter.registerLanguage('nginx', langNginx);
SyntaxHighlighter.registerLanguage('ini', langIni);
// C-like base grammar: registered on demand as a fallback for obscure
// languages with no dedicated grammar, so they still get basic token coloring
// (comments, strings, numbers, keywords, operators).
SyntaxHighlighter.registerLanguage('clike', langClike);

// Register .orb and .lolo languages from @almadar/syntax (refractor-compatible)
SyntaxHighlighter.registerLanguage('orb', orbLanguage);
SyntaxHighlighter.registerLanguage('lolo', loloLanguage);

export const prism = { SyntaxHighlighter, createHighlightElement, dark, light, clike: langClike };
