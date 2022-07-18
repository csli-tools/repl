#!/usr/bin/env node
import * as repl from "../src/index.js"
repl.main(process.argv.slice(2)).then(() => {
  console.info('.exit — to get outta here')
}).catch(e => {
  console.log('Uh oh:', e)
  console.log('Can you please create an issue for this?')
  console.log('https://github.com/csli-tools/repl/issues/new')
});
