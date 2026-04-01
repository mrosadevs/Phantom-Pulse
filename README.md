<div align="center">

# 👻 Phantom Pulse

### ⚡ QuickBooks Desktop Transaction Manager ⚡

**A sleek Electron desktop app for tracking, visualizing, and managing QuickBooks Desktop financial data in real-time.**

[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-C8FF00?style=for-the-badge)](LICENSE)

---

📊 **Dashboard** · 📥 **Import** · 📤 **Export** · ✏️ **Modify** · 🗑️ **Delete** · ⏳ **History** · 📒 **GL Import** · ⚙️ **Settings**

---

</div>

## 🎬 What is Phantom Pulse?

Phantom Pulse is a **desktop application** that bridges the gap between QuickBooks Desktop and modern data workflows. Import transactions via CSV, visualize your financial data with interactive charts, modify or clean records in bulk, and export polished spreadsheets — all wrapped in a dark, cyberpunk-inspired UI.

Built with **Electron + React + TypeScript** and powered by **Recharts** for data visualization, it's designed for accountants and bookkeepers who need to wrangle QuickBooks data fast.

---

## 🚀 Features

### 📱 8 Core Pages

| Page | Description |
|------|-------------|
| 📊 **Dashboard** | Real-time financial overview with interactive charts and summaries |
| 📥 **Import** | Drag-and-drop CSV/Excel import from QuickBooks Desktop exports |
| ✏️ **Modify** | Bulk edit, clean descriptions, and recategorize transactions |
| 🗑️ **Delete** | Smart filtering and batch deletion with safety confirmations |
| 📤 **Export** | Generate polished Excel workbooks with formatted sheets |
| ⏳ **History** | Full audit trail of all imports, edits, and exports |
| 📒 **GL Import** | Upload a QuickBooks General Ledger PDF and auto-import the Chart of Accounts, Customers, and Vendors directly into QB Desktop |
| ⚙️ **Settings** | App preferences, data management, and theme options |

### 📊 Data Visualization
- 📈 **Interactive charts** powered by Recharts
- 🍩 Category breakdowns with donut charts
- 📅 Timeline views for transaction trends
- 💰 Income vs. expense comparisons

### 🔄 Transaction Management
- 📋 **TanStack Table** — sortable, filterable, paginated data grids
- ✏️ Bulk edit descriptions and categories
- 🔍 Advanced search and multi-column filtering
- 🏷️ Smart categorization engine

### 💾 Import & Export
- 📥 CSV and Excel import from QuickBooks Desktop
- 📤 Multi-sheet Excel export with formatting
- 🔗 **WinAX integration** for direct QuickBooks COM access (Windows)
- 📦 PapaParse for lightning-fast CSV parsing
- 📒 **GL PDF Import** — parse a QB General Ledger PDF and bulk-create accounts, customers, and vendors in QB Desktop via QBSDK

### 🎨 Design & UX
- 🌙 Dark cyberpunk theme with purple and cyan accents
- ✨ Smooth animations powered by Framer Motion
- 🔔 Toast notifications via Sonner
- 🖥️ Native desktop experience with Electron

---

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| ⚛️ **React 18** | UI components and state management |
| 📘 **TypeScript** | Type-safe development |
| ⚡ **Electron 31** | Native desktop shell |
| 🔧 **electron-vite** | Fast dev server and build tooling |
| 🎨 **Tailwind CSS** | Utility-first styling |
| 📊 **Recharts** | Interactive data visualization |
| 📋 **TanStack Table** | Powerful data grid |
| 🗃️ **Zustand** | Lightweight state management |
| 📄 **SheetJS (xlsx)** | Excel import/export |
| 📑 **PapaParse** | CSV parsing engine |
| 🎭 **Framer Motion** | Smooth animations |
| 🔗 **WinAX** | QuickBooks Desktop COM bridge |
| 🐍 **Python + pypdf** | General Ledger PDF parsing |
| 💾 **electron-store** | Persistent app settings |

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- npm (comes with Node.js)
- Windows (required for QuickBooks Desktop COM integration)
- [Python 3](https://www.python.org/) + `pip install pypdf` (required for GL PDF parsing)

### Installation

```bash
# Clone the repo
git clone https://github.com/mrosadevs/Phantom-Pulse.git

# Navigate to the project
cd Phantom-Pulse

# Install dependencies
npm install

# Start the dev server
npm run dev
```

### Build for Production

```bash
# Build the app
npm run build

# Package as installer
npm run package
```

This generates a Windows `.exe` installer in the `dist/` folder.

---

## 🗂️ Project Structure

```
👻 Phantom-Pulse/
├── 📄 package.json                 # Dependencies & scripts
├── ⚙️ electron.vite.config.ts      # Electron-Vite configuration
├── 🎨 tailwind.config.ts           # Tailwind CSS config
├── 📘 tsconfig.json                # TypeScript config
│
├── 🖥️ src/main/                    # Electron main process
│   └── index.ts                    # Window creation & IPC handlers
│
├── 🔗 src/preload/                 # Preload scripts
│   └── index.ts                    # Secure bridge between main & renderer
│
├── ⚛️ src/renderer/src/            # React frontend
│   ├── App.tsx                     # Root component & routing
│   ├── main.tsx                    # React entry point
│   │
│   ├── 📄 pages/
│   │   ├── Dashboard.tsx           # Financial overview
│   │   ├── Import/                 # Import wizard
│   │   ├── GLImport/               # GL PDF → QB accounts/customers/vendors
│   │   ├── Modify.tsx              # Bulk editing
│   │   ├── Delete.tsx              # Batch deletion
│   │   ├── Export.tsx              # Excel export
│   │   ├── History.tsx             # Audit trail
│   │   └── Settings.tsx            # App preferences
│   │
│   ├── 🧩 components/layout/      # Sidebar, header, nav
│   ├── 🗃️ store/                   # Zustand state stores
│   ├── 📊 data/                    # Static data & categories
│   ├── 🔧 utils/                   # Helper functions
│   ├── 📘 types/                   # TypeScript interfaces
│   └── 🎨 styles/                  # Global CSS
│
└── 📁 out/                         # Build output
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to open an issue or submit a pull request.

---

## 📄 License

This project is [MIT](LICENSE) licensed.

---

<div align="center">

**Built with 💜 by [@mrosadevs](https://github.com/mrosadevs)**

*Your QuickBooks data, supercharged.* 👻

</div>
