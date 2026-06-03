# EJAF Technology – CCTV Project Planner
### Powered by Siwar

> **Professional CCTV System Calculator & Project Manager**  
> Web App | Bilingual (AR/EN) | Standards: IEC 62676 · TIA-568 · EN 50132 · NFPA 72

---

## 🚀 Live Demo
**[Open App → GitHub Pages Link]**

---

## ✨ Features

| Feature | Description |
|---|---|
| 📋 Project Setup | Full project info, building type, international standards |
| 📷 Camera Config | 15+ brands (Axis, Bosch, Hikvision, Dahua...), Dome/Bullet/PTZ/Fisheye, IP ratings |
| 🗄️ Rack Distribution | Per-floor, per-2/3/5 floors, central rack, custom groups |
| 🔌 Cable Calculator | Cat6/6A/7/8, Fiber, RG59/RG6, TIA-568 waste factor, per-floor lengths |
| 👷 Labor Estimator | Editable rates, difficulty factors, team size, workday calculation |
| 🗺️ Floor Plan | Upload images, click-to-place cameras & racks (Fabric.js) |
| 📄 PDF Export | Professional report (Arabic + English), jsPDF |
| 📊 Excel Export | 5-sheet workbook (Project, Floors, Cables, Labor, Racks), SheetJS |
| 🌐 Bilingual | Full Arabic/English toggle (RTL/LTR) |

---

## 📐 International Standards Applied
- **IEC 62676** – Video Surveillance Systems for use in Security Applications
- **TIA-568-C.2** – Structured Cabling (100m max for Cat6/6A)
- **EN 50132** – Alarm Systems CCTV Surveillance
- **NFPA 72** – National Fire Alarm and Signaling Code
- **BS 8418** – Installation and remote monitoring of detector-activated CCTV systems
- **IEEE 802.3af/at/bt** – PoE Standards (15.4W / 30W / 90W)

---

## 📦 Tech Stack
- **Pure HTML/CSS/JS** – No framework, no build step
- **Fabric.js** – Interactive floor plan canvas
- **jsPDF + autoTable** – PDF generation
- **SheetJS (XLSX)** – Excel export
- **Google Fonts** – Cairo (AR) + Rajdhani + IBM Plex Mono

---

## 🚀 Deploy on GitHub Pages

1. Fork or clone this repository
2. Go to **Settings → Pages**
3. Source: **Deploy from branch** → `main` → `/root`
4. Your app will be live at: `https://<username>.github.io/<repo-name>/`

---

## 📁 Project Structure
```
cctv-planner/
├── index.html          # Main app
├── css/
│   └── style.css       # Dark industrial theme
├── js/
│   └── app.js          # All logic (calculation, export, canvas)
└── README.md
```

---

## 📊 Calculation Methodology

### Cable Length
```
Total Cable = Σ (cameras_per_floor × avg_distance) × (1 + waste_factor%)
```

### Labor Days
```
Total Hours = (install × rate × difficulty) + (cable_pull × rate × difficulty) + (rack × rate × difficulty) + config + commissioning
Workdays = ⌈Total Hours / (team_size × hours_per_day)⌉
```

### Storage Estimate
```
Storage (GB) = total_cameras × 2 GB/day × archive_days
```

---

## 🏷️ Branding
- **Ejaf Technology** – System Owner
- **Powered by Siwar** – Development Partner

---

*© 2025 Ejaf Technology · All Rights Reserved*
