# Logic Circuit Web

**🇬🇧 English** | **[🇩🇪 Deutsch](README.de.md)**

**Logic Circuit Web** brings the free digital logic circuit simulator [Logic Circuit](https://www.logiccircuit.org/) by Eugene Lepekhin into the browser as a modern, platform-independent web application built with TypeScript, React, Vite, Emotion, and WebWorkers.

👉 **[🚀 Open Live Demo on GitHub Pages](https://afe-gmdg.github.io/logic-circuit-web/)**

---

## ✨ Key Features

- **Interactive Schematics Editor:**
  - Smooth pan and zoom canvas with integer grid alignment (`18px` grid unit) and authentic ANSI logic gate glyphs (`NOT`, `AND`, `NAND`, `OR`, `NOR`, `XOR`, `XNOR` with 2–18 inputs, `Clock`, `Tri-State`).
  - Smart wire routing (`Wire` & `ConductorMap`) with automatic T-junction solder dots, manual wire splitting/merging, endpoint dragging, rubberbanding, and instant bit-width / short-circuit validation.
  - Floating Copy/Cut/Paste and floating move with live collision detection, `90°` parity-preserving rotation (`R` / `L`), per-circuit delta Undo/Redo history (`Ctrl+Z` / `Ctrl+Y`), CleanUp visualization for unused nets/bus bits, and project-wide component & signal search (`Ctrl+F`).
- **Hierarchical Sub-Circuits:**
  - Encapsulate any `LogicalCircuit` as a reusable component with configurable symbol shapes (`Rectangular`, `Display`, `MUX`, `DEMUX`, `ALU`, `Flip-Flop`), custom pin ordering per side, `jamNotation` pin labels, and live interactive `Display` previews.
  - Double-click sub-circuit instances during active simulation to inspect their internal live state via the hierarchical `RunningTree`.
- **Rich I/O, Memory, Audio & Graphics Components:**
  - **Inputs & Probes:** Push buttons / toggle switches (`CircuitButton`) with keyboard shortcut triggers, multi-bit constants (`Constant`), multi-format probes (`CircuitProbe` in Hex/Dec/Bin), bus splitters (`Splitter`, 2–32 bits), and programmable `Sensor` modules (`Random`, `Manual`, `Series`, `Loop`, `ASCII`, `KeyCode`, `Sequence`, `Clock`).
  - **Displays:** Single LEDs, 7-segment indicators, configurable LED matrices (`Individual` & `Selector`), and memory-mapped **`GraphicsArray`** displays (`1`, `2`, `4`, or `8` bits per pixel up to `640×480` with delta VRAM sync, PNG export, and live VRAM inspector).
  - **Memory (`RAM` & `ROM`):** Up to 16-bit address and 32-bit data width, single/dual-port, built-in Hex/ASCII editor, binary file import/export, and live in-simulation memory inspector.
  - **Audio:** Standard buzzer (`Sound`) and 8-bit `Synthesizer` (frequency, volume, waveform modes via Web Audio API) with global mute toggle.
- **High-Performance WebWorker Simulation Engine:**
  - Event-driven three-state logic (`Off`/Tri-State, `On0`, `On1`) using a fast `DirtyList` evaluator inside a dedicated WebWorker.
  - Zero runtime overhead for hierarchy frames, pins, and splitters thanks to compile-time hierarchy flattening (`CircuitMap`).
  - Supports single-stepping (`F10`), target clock frequencies (`1 Hz` – `60 Hz`), and an unthrottled **Max-FPS** mode decoupled via `requestAnimationFrame`.
- **Analysis, Oscilloscope & HDL Export:**
  - Truth table evaluation in the WebWorker (`Ctrl+T`, up to `4096` rows, `validators` expression filter, TSV/CSV export), hierarchical usage finder (`UsageDialog`), and structured circuit report (`ReportDialog` with Markdown export).
  - Floating interactive oscilloscope (`Ctrl+O`) and single-probe history dialog (`ProbeHistoryDialog`) with multi-bit bus decoding, zoom, markers, and measurement cursor.
  - Multi-target HDL export for **Verilog/SystemVerilog** (`.sv` + testbench), **VHDL** (`.vhd` + testbench), and **Nand2Tetris HDL** (`.hdl`, `.tst`, `.cmp`) with live preview and multi-file folder export via File System Access API.
- **Circuit Library & Standard ICs:**
  - Persistent personal circuit library (`*.lclib`) via File System Access API (plus read-only reload cache), built-in standard ICs, switchable sidebar (`Project` ↔ `Library`), sub-circuit extraction with hash deduplication, and dedicated color-coded library editing mode.
- **Real-Time WebRTC Collaboration:**
  - Direct peer-to-peer collaboration sessions with ephemeral 5-minute role-based invite links (*Guest* / *Collaborator*, without lobby or chat), host-authoritative model synchronization with 200-revision ring-buffer catch-up, soft-locks, per-user Undo/Redo, and protected host handover.
  - Live participant panel with local `Name → Color` management, decoupled live cursors (with configurable idle timeout and visibility filters), independent viewport navigation & "Follow participant", plus side-effect-free local snapshot simulation with background delta buffering and automatic catch-up on stop.
- **Native `.lcweb` Project Format & Desktop `.CircuitProject` Compatibility:**
  - Native, strictly validated JSON project format (`*.lcweb`) with direct disk access via the browser's File System Access API (`IndexedDB` directory & file handles).
  - Seamless XML import and normalized export for LogicCircuit Desktop (`*.CircuitProject`, schema `2.0.0.14`).
  - Scale-accurate `PNG (1:1)` and `SVG` schematic export (dark grid or transparent background, including live simulation state).
- **Internationalization (i18n):**
  - Full English and German UI localization (`i18next` / `react-i18next`) with automatic browser locale detection and instant status bar language switcher.
- **Model Context Protocol (MCP) for AI Assistants & BYO SideCar:**
  - Built-in bidirectional **Streamable-HTTP MCP (`/mcp`)** bridge allowing AI agents (such as Antigravity or Claude Desktop) to inspect, build, validate, and simulate circuits in real time — locally via Vite HMR (`http://localhost:5173/mcp`) or remotely via a stateless, GDPR-compliant Node 22 Sidecar with Auth-First protection, in-memory rate limiting, and multi-tab `SharedWorker`.
  - **Bring Your Own SideCar (`BYO SideCar`):** On static GitHub Pages builds, MCP and WebRTC Collaboration remain completely silent until explicitly enabled with a custom Sidecar URL (`http://localhost:3001` or `https://...`); a standalone Sidecar package (`.zip`) can be downloaded directly via **Help → Download SideCar...** with automatic SemVer compatibility checks.

---

## 🚀 Quick Start & Development

### Prerequisites
- **Node.js** `>= 22`
- **Yarn** `1.x`

### Clone & Install
```bash
git clone --recurse-submodules https://github.com/AFE-GmdG/logic-circuit-web.git
cd logic-circuit-web
yarn install
```

### Commands

| Command | Description |
| :--- | :--- |
| `yarn dev` | Starts the Vite development server at `http://localhost:5173` (with local MCP bridge enabled) |
| `yarn build` | Builds the production bundle into `dist/` (with opt-in Remote MCP, WebRTC Collab & `downloads/logic-circuit-sidecar.zip`) |
| `yarn build:pages` | Builds the static GitHub Pages bundle into `dist/` (`--mode pages` / `SIDECAR_CUSTOM_ONLY=true`: zero default network traffic, opt-in BYO SideCar + downloadable Sidecar ZIP) |
| `yarn build:sidecar-zip` | Generates the standalone Node 22 / Docker Sidecar ZIP archive under `dist/downloads/` |
| `yarn preview` | Previews the production build locally |
| `yarn test` | Runs the automated Vitest unit and integration test suite |
| `yarn errorcheck` | Runs TypeScript type checking for frontend (`tsconfig.json`) and server (`tsconfig.server.json`) |
| `yarn lint` | Runs ESLint across all TypeScript and React files |
| `yarn lint-docs` | Validates markdown documentation structure inside `docs/` |

---

## ⌨️ Essential Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+S` | Save project (`*.lcweb`) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo (per logical circuit) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Floating Paste |
| `Ctrl+A` / `Del` | Select all / Delete selected elements |
| `R` / `L` (or `Shift+R`) | Rotate selection `90°` clockwise / counter-clockwise |
| `F2` / Double-click | Open properties dialog for selected component or active circuit |
| `Ctrl+F` | Open project-wide component & signal search |
| `Ctrl+T` | Open truth table evaluator |
| `F5` / `Shift+F5` | Start or pause simulation / Stop simulation |
| `Ctrl+O` | Open oscilloscope during simulation |
| `F10` | Single-step simulation |

---

## 📚 Project Documentation

Detailed technical documentation is located in the [`docs/`](docs/) directory *(written in German)*:

- **[`docs/intro.md`](docs/intro.md):** Project vision, documentation methodology, and Kanban workflow.
- **[`docs/data-model.md`](docs/data-model.md):** Deep-dive specification of the circuit data model (`CircuitProject`, `Circuit`, `CircuitSymbol`, `Jam`, `ConductorMap`, `CircuitMap`, `CircuitState`).
- **[`docs/mcp.md`](docs/mcp.md):** Architecture, tool catalog, and deployment guide for the local and remote Model Context Protocol (MCP) integration.
- **[`docs/coding-rules.md`](docs/coding-rules.md):** Mandatory TypeScript, React, Emotion, and formatting guidelines.
- **[`docs/history.md`](docs/history.md):** Comprehensive chronicle of all completed releases, user stories, tasks, and bug fixes.
- **[`docs/scrum-board.md`](docs/scrum-board.md):** Development board, backlog, and roadmap.

---

## 🙏 Credits & License

- **Original Concept & Desktop Reference:** [Logic Circuit](https://www.logiccircuit.org/) by **Eugene Lepekhin** ([GitHub Repository](https://github.com/eugenelepekhin/LogicCircuit)), included as a reference submodule under `reference/LogicCircuit`.
- **Logic Circuit Web Author:** Andreas Friedel
- **AI Co-Author:** Antigravity (Google DeepMind)
- **License:** Released under the **[MIT License](LICENSE)**.
