#/bin/bash
set -e

cp ~/code/decent-auth-rs/target/wasm32-wasip1/release/decent_auth_rs.wasm ./decent_auth.wasm
node examples/basic_nonbrowser/index.js
