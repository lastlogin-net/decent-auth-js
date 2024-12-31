#/bin/bash
set -e

cp ~/code/decent-auth-rs/target/wasm32-wasip1/release/decentauth.wasm ./
node examples/minimal/index.js $@
