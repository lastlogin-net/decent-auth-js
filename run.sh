#/bin/bash
set -e

cp ~/code/decent-auth-rs/target/wasm32-wasip1/release/decentauth.wasm ./
node examples/basic_nonbrowser/index.js $@
