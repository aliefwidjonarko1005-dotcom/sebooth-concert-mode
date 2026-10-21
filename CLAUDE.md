@agents.md

# Harness Claude Code

## Loop kerja
1. **Orientasi**: buka `docs/agent/CODEMAP.md` (peta "mau ubah X → file mana") lalu `graphify query "<pertanyaan>"` dulu sebelum grep luas. Graph basi (commit beda dari `git rev-parse HEAD`)? → `npm run graph:update`.
2. **Pilih skill** dari `docs/agent/SKILLS_INDEX.md`. Default: `ponytail` untuk semua coding; bug hardware/kamera → `investigate-first`; UI → `frontend-design`.
3. **Ubah sekecil mungkin**, ikuti aturan & jebakan di `agents.md`.
4. **Verifikasi**: `rtk err npm run typecheck` harus tidak menambah error baru. Perubahan UI → jalankan `sebooth-dev` (`.claude/launch.json`) dan cek halaman yang disentuh. Hardware tidak bisa dites di sini → bilang terus terang.
5. **Catat**: 1 baris di `docs/agent/CHANGELOG.md`; refresh graph kalau struktur berubah.

## Output panjang → rtk
`rtk git diff|log|status`, `rtk tsc`, `rtk grep`, `rtk err <cmd>`, `rtk log <file>`, `rtk json <file>`.

## Jangan
- Commit/push tanpa diminta. Jangan commit `.env`, `google-key.json`, `gen-lang-client-*.json`, `.agents/mcp_config.json`.
- Jangan edit `out/`, `node_modules/`, `graphify-out/` manual.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
