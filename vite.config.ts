import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { melPlugin } from "@manifesto-ai/compiler/vite";
import { createCompilerCodegen } from "@manifesto-ai/codegen";

// https://vite.dev/config/
export default defineConfig({
  plugins: [melPlugin({ codegen: createCompilerCodegen() }), react()],
})
