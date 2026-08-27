// The generated profile is a single self-contained file with no external
// requests, so its stylesheet has to ship inline. It lives here rather than
// inside the markup template to keep presentation separate from the data
// projection that builds the page.
export const PROFILE_STYLES = `
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: rgba(19, 27, 48, .78);
      --panel-strong: #151e34;
      --text: #edf2ff;
      --muted: #9aa8c4;
      --line: rgba(151, 170, 209, .18);
      --accent: #7ee0c3;
      --accent-2: #9ba7ff;
      --shadow: 0 24px 70px rgba(0, 0, 0, .28);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 8% 0%, rgba(87, 106, 255, .20), transparent 28rem),
        radial-gradient(circle at 92% 8%, rgba(44, 219, 174, .14), transparent 30rem),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 38px 0 72px; }
    .hero {
      display: grid;
      grid-template-columns: 1.5fr .8fr;
      gap: 24px;
      padding: clamp(28px, 6vw, 64px);
      border: 1px solid var(--line);
      border-radius: 30px;
      background: linear-gradient(135deg, rgba(25, 34, 62, .93), rgba(13, 21, 39, .78));
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
    }
    .hero::after {
      content: "AWB";
      position: absolute;
      right: -18px;
      bottom: -58px;
      font-size: clamp(110px, 19vw, 230px);
      font-weight: 900;
      letter-spacing: -.08em;
      color: rgba(255, 255, 255, .025);
      pointer-events: none;
    }
    .brand { color: var(--accent); font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    h1 { font-size: clamp(42px, 7vw, 82px); line-height: .98; letter-spacing: -.055em; margin: 18px 0 22px; max-width: 760px; }
    h2 { font-size: clamp(28px, 4vw, 42px); letter-spacing: -.035em; margin: 0; }
    h3 { font-size: 19px; margin: 4px 0 0; }
    p { line-height: 1.65; }
    .lede { color: var(--muted); font-size: 18px; max-width: 680px; }
    .hero-stats { display: grid; gap: 12px; align-content: center; position: relative; z-index: 1; }
    .stat { padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: rgba(6, 12, 25, .36); }
    .stat strong { display: block; font-size: 34px; letter-spacing: -.04em; }
    .stat span { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
    .section { margin-top: 58px; }
    .section-head { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 22px; }
    .section-head p { margin: 0; color: var(--muted); max-width: 560px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .card, .profile-copy, .relations, .task {
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(16px);
      border-radius: 20px;
      box-shadow: 0 12px 38px rgba(0, 0, 0, .14);
    }
    .card { padding: 22px; }
    .card-head { display: flex; justify-content: space-between; gap: 14px; align-items: start; }
    .eyebrow { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0; }
    .muted { color: var(--muted); }
    .pill, .tag { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
    .pill { padding: 6px 10px; color: #cbd5ef; background: rgba(255,255,255,.03); font-size: 12px; }
    .pill.accent { color: #092018; border-color: transparent; background: var(--accent); font-weight: 750; }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; min-height: 24px; }
    .tag { padding: 4px 8px; color: var(--accent-2); font-size: 11px; }
    .path { display: block; color: #bbc8e3; padding: 10px 12px; margin-top: 14px; background: #0b1222; border-radius: 10px; overflow-wrap: anywhere; }
    .mini-stats { display: flex; gap: 18px; padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    .mini-stats strong { color: var(--text); }
    .profile-layout { display: grid; grid-template-columns: 1.25fr .75fr; gap: 16px; }
    .profile-copy { padding: clamp(24px, 4vw, 40px); }
    .profile-copy h1 { font-size: 36px; margin: 0 0 24px; }
    .profile-copy h2 { font-size: 24px; margin: 30px 0 10px; }
    .profile-copy ul { padding-left: 20px; color: var(--muted); }
    .profile-copy code { color: var(--accent); }
    .capabilities { display: grid; gap: 12px; }
    .capability { padding: 20px; border-radius: 18px; border: 1px solid var(--line); background: var(--panel); }
    .capability strong { font-size: 24px; display: block; }
    .capability span { color: var(--muted); }
    .relations { padding: 16px; }
    .relation-row { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(120px, .7fr) minmax(100px, 1fr); gap: 12px; align-items: center; padding: 14px; border-bottom: 1px solid var(--line); }
    .relation-row:last-child { border-bottom: 0; }
    .relation-row p { grid-column: 1 / -1; color: var(--muted); margin: 0; font-size: 13px; }
    .node { padding: 10px 12px; border-radius: 10px; background: var(--panel-strong); text-align: center; font-weight: 700; }
    .relation-arrow { color: var(--muted); text-align: center; font-size: 13px; }
    .relation-arrow span { color: var(--accent); }
    .tasks { display: grid; gap: 12px; }
    .task { padding: 22px; display: flex; justify-content: space-between; gap: 24px; align-items: center; }
    .task-meta { display: flex; justify-content: end; flex-wrap: wrap; gap: 7px; max-width: 380px; }
    .empty { padding: 34px; text-align: center; border: 1px dashed var(--line); border-radius: 18px; color: var(--muted); grid-column: 1 / -1; }
    .empty strong { display: block; color: var(--text); margin-bottom: 6px; }
    footer { margin-top: 58px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 20px; color: var(--muted); font-size: 12px; }
    @media (max-width: 850px) {
      .hero, .profile-layout { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr 1fr; }
      .hero-stats { grid-template-columns: repeat(3, 1fr); }
      .stat { padding: 14px; }
      .stat strong { font-size: 25px; }
    }
    @media (max-width: 600px) {
      .shell { width: min(100% - 20px, 1180px); padding-top: 10px; }
      .hero { border-radius: 22px; }
      .grid, .hero-stats { grid-template-columns: 1fr; }
      .section-head, .task, footer { align-items: start; flex-direction: column; }
      .task-meta { justify-content: start; }
      .relation-row { grid-template-columns: 1fr; }
    }
`;
