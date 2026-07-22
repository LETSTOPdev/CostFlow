/** Server-rendered HTML shell + premium design system (doc 09 P4.1 — no SPA build). */

import { HEADER_MARK } from './brand';

export function esc(value: string): string {
  // Defense in depth: a mistyped non-string (e.g. a Date leaking from the DB
  // driver) must never crash the render layer with `replaceAll is not a
  // function` (P4.2 defect 2). The root cause is fixed at the store boundary;
  // this guarantees the page still renders even if one slips through.
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The design system. One inline stylesheet, delivered on every page within the
 * strict CSP (`style-src 'unsafe-inline'`, `script-src 'none'`, no external
 * fonts). Everything premium is done in pure CSS: a fluid modular type scale,
 * tokenized color/shadow/gradient, custom form controls, modern cards, badges,
 * a stepper, a gradient hero system, smooth transitions, and a light/dark
 * theme via `prefers-color-scheme`. System font stack only — Inter/SF first,
 * degrading gracefully.
 */
const STYLES = `
:root{
  --font:'Inter','SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  --mono:'SF Mono','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ink:#0d0e14; --ink-2:#33353f; --muted:#5c5f6e; --faint:#8a8d9b;
  --line:#e9e9f0; --line-2:#f2f2f6;
  --bg:#ffffff; --bg-2:#fafafc; --surface:#ffffff; --surface-2:#f7f7fb;
  --primary:#5b54e6; --primary-2:#4a42d4; --violet:#8b5cf6;
  --grad:linear-gradient(135deg,#6366f1 0%,#8b5cf6 52%,#a855f7 100%);
  --grad-soft:linear-gradient(135deg,#eef0ff 0%,#f5eefe 100%);
  --pos:#0ea371; --pos-ink:#0a7a52; --pos-bg:#e7f7f0; --pos-line:#bfe8d5;
  --warn:#c2820a; --warn-ink:#9a6800; --warn-bg:#fdf6e3; --warn-line:#f0dca6;
  --neg:#e5484d; --neg-ink:#c0393e; --neg-bg:#fdecec; --neg-line:#f4c4c6;
  --radius:16px; --radius-sm:11px; --radius-lg:22px;
  --sh-1:0 1px 2px rgba(13,14,20,.05),0 1px 3px rgba(13,14,20,.05);
  --sh-2:0 4px 14px -3px rgba(13,14,20,.09),0 2px 6px -2px rgba(13,14,20,.05);
  --sh-3:0 20px 44px -14px rgba(30,24,74,.22),0 8px 18px -10px rgba(30,24,74,.14);
  --ring:0 0 0 4px rgba(99,102,241,.18);
  --ease:cubic-bezier(.4,0,.2,1);
  --container:69rem;
}
@media (prefers-color-scheme:dark){
  :root{
    --ink:#f4f5fb; --ink-2:#c9cbd7; --muted:#9a9db2; --faint:#71748c;
    --line:#242634; --line-2:#1b1d29;
    --bg:#0a0b11; --bg-2:#0f111a; --surface:#12141d; --surface-2:#171923;
    --primary:#8b87f5; --primary-2:#a29dff; --violet:#a78bfa;
    --grad-soft:linear-gradient(135deg,rgba(99,102,241,.20),rgba(168,85,247,.16));
    --pos-ink:#4fd6a3; --pos-bg:rgba(14,163,113,.14); --pos-line:rgba(14,163,113,.34);
    --warn-ink:#e6bd63; --warn-bg:rgba(194,130,10,.16); --warn-line:rgba(194,130,10,.36);
    --neg-ink:#f0888c; --neg-bg:rgba(229,72,77,.14); --neg-line:rgba(229,72,77,.36);
    --sh-1:0 1px 2px rgba(0,0,0,.45); --sh-2:0 6px 18px -5px rgba(0,0,0,.6);
    --sh-3:0 26px 52px -14px rgba(0,0,0,.72); --ring:0 0 0 4px rgba(139,135,245,.26);
  }
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:var(--font);color:var(--ink-2);background:var(--bg);
  font-size:16.5px;line-height:1.62;letter-spacing:-.011em;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  text-rendering:optimizeLegibility;font-feature-settings:'cv05','ss01';}
h1,h2,h3,h4{color:var(--ink);line-height:1.14;letter-spacing:-.025em;font-weight:640;margin:0 0 .55em;text-wrap:balance}
h1{font-size:clamp(1.95rem,1.3rem+2.5vw,3.1rem);letter-spacing:-.038em}
h2{font-size:clamp(1.4rem,1.1rem+1.1vw,1.9rem);letter-spacing:-.03em}
h3{font-size:1.14rem;letter-spacing:-.02em}
h4{font-size:1rem}
p{margin:0 0 1rem;text-wrap:pretty}
a{color:var(--primary);text-decoration:none;transition:color .15s var(--ease),opacity .15s var(--ease)}
a:hover{color:var(--primary-2)}
a:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px}
strong{color:var(--ink);font-weight:620}
hr{border:none;border-top:1px solid var(--line);margin:2rem 0}
::selection{background:rgba(139,92,246,.22)}

.container{max-width:var(--container);margin-inline:auto;padding-inline:clamp(1.15rem,4vw,2rem);width:100%}
main.page{padding:2.75rem 0 4.5rem}
main.bleed{display:block}

/* Header */
.site-header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 78%,transparent);
  -webkit-backdrop-filter:saturate(180%) blur(16px);backdrop-filter:saturate(180%) blur(16px);
  border-bottom:1px solid var(--line)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:66px}
.brand{display:inline-flex;align-items:center;gap:.6rem;font-weight:680;font-size:1.08rem;color:var(--ink);letter-spacing:-.02em}
.brand:hover{color:var(--ink)}
.nav{display:flex;align-items:center;gap:1.35rem;font-size:.93rem;font-weight:500}
.nav a{color:var(--muted)} .nav a:hover{color:var(--ink)}
.nav a.btn{color:#fff}
.nav-extra{display:contents}
.nav .sep{color:var(--line);user-select:none}
.signout{display:inline;margin:0}
.signout button{margin:0;background:none;border:none;box-shadow:none;color:var(--muted);cursor:pointer;padding:0;font:inherit;font-weight:500;transition:color .15s var(--ease)}
.signout button:hover{color:var(--ink);transform:none;filter:none}

/* Buttons */
.btn,form:not(.signout) button{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  padding:.72rem 1.3rem;border-radius:12px;border:1px solid transparent;
  background:var(--grad);color:#fff;font-family:var(--font);font-weight:600;font-size:.96rem;letter-spacing:-.01em;
  cursor:pointer;text-decoration:none;white-space:nowrap;
  box-shadow:var(--sh-2),inset 0 1px 0 rgba(255,255,255,.2);
  transition:transform .16s var(--ease),box-shadow .16s var(--ease),filter .16s var(--ease)}
.btn:hover,form:not(.signout) button:hover{transform:translateY(-1px);box-shadow:var(--sh-3),inset 0 1px 0 rgba(255,255,255,.2);filter:saturate(1.06) brightness(1.02);color:#fff}
.btn:active,form:not(.signout) button:active{transform:translateY(0);box-shadow:var(--sh-1)}
.btn:focus-visible,button:focus-visible{outline:none;box-shadow:var(--ring)}
a.btn{color:#fff}
.btn-lg{padding:.9rem 1.7rem;font-size:1.03rem;border-radius:14px}
.btn-sm{padding:.5rem .95rem;font-size:.88rem;border-radius:10px}
.btn-ghost,a.btn-ghost{background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:var(--sh-1)}
.btn-ghost:hover,a.btn-ghost:hover{background:var(--surface-2);border-color:color-mix(in srgb,var(--primary) 30%,var(--line));color:var(--ink);filter:none}
.btn-block{width:100%}

/* Forms */
label{display:block;margin:0 0 1.05rem;font-weight:560;color:var(--ink);font-size:.9rem}
input[type=text],input[type=email],input[type=password],input[type=url],input[type=number],input:not([type]),select,textarea{
  display:block;width:100%;margin-top:.42rem;padding:.72rem .9rem;
  font-family:var(--font);font-size:.98rem;color:var(--ink);background:var(--surface);
  border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh-1);
  -webkit-appearance:none;appearance:none;
  transition:border-color .15s var(--ease),box-shadow .15s var(--ease),background .15s var(--ease)}
input::placeholder{color:var(--faint)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary);box-shadow:var(--ring)}
select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%235c5f6e' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .9rem center;padding-right:2.3rem}
input[type=checkbox],input[type=radio]{width:1.05rem;height:1.05rem;margin:0 .5rem 0 0;accent-color:var(--primary);vertical-align:-2px;cursor:pointer}
/* Compact, inline-sized inputs (assumption ranges/rates keep their size attr). */
input[size]{display:inline-block;width:auto;margin-top:0;padding:.48rem .6rem;vertical-align:middle;text-align:center}
fieldset{border:1px solid var(--line);border-radius:14px;padding:1rem 1.15rem;margin:0 0 1.25rem}
legend{font-weight:620;color:var(--ink);padding:0 .4rem}
/* Inline forms (member/role controls): keep control + button on one line. */
form.inline{display:inline-flex;align-items:center;gap:.4rem;margin:0;vertical-align:middle}
form.inline select,form.inline input{width:auto;display:inline-block;margin:0}
form.inline button{padding:.42rem .8rem;font-size:.85rem;box-shadow:var(--sh-1)}
/* Onboarding radio/list rows as selectable cards. */
.pick{display:block;margin:0 0 .6rem}
.pick input{position:absolute;opacity:0;pointer-events:none}
.pick > span{display:flex;align-items:center;gap:.7rem;padding:.85rem 1.05rem;border:1px solid var(--line);border-radius:12px;
  background:var(--surface);box-shadow:var(--sh-1);cursor:pointer;font-weight:550;color:var(--ink);
  transition:border-color .15s var(--ease),box-shadow .15s var(--ease),background .15s var(--ease)}
.pick > span::before{content:'';flex:none;width:1.15rem;height:1.15rem;border-radius:50%;border:2px solid var(--line);transition:all .15s var(--ease)}
.pick:hover > span{border-color:color-mix(in srgb,var(--primary) 40%,var(--line))}
.pick input:checked + span{border-color:var(--primary);background:var(--grad-soft);box-shadow:var(--ring)}
.pick input:checked + span::before{border-color:var(--primary);background:var(--primary);box-shadow:inset 0 0 0 3px var(--surface)}
.pick input:focus-visible + span{box-shadow:var(--ring)}

/* Cards & surfaces */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem;box-shadow:var(--sh-1);
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),border-color .18s var(--ease)}
.card-hover:hover{transform:translateY(-3px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 22%,var(--line))}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem 1.75rem;box-shadow:var(--sh-1);margin:0 0 1.5rem}
.ws{border:1px solid var(--line);border-radius:12px;padding:.9rem 1.1rem;margin:.6rem 0;background:var(--surface);box-shadow:var(--sh-1)}
.ws h4{margin:0 0 .35rem}

/* Text helpers */
.note{color:var(--muted);font-size:.9rem}
.eyebrow{display:inline-flex;align-items:center;gap:.5rem;font-size:.76rem;font-weight:640;letter-spacing:.07em;text-transform:uppercase;
  color:var(--primary);background:var(--grad-soft);border:1px solid color-mix(in srgb,var(--primary) 22%,transparent);
  padding:.36rem .82rem;border-radius:999px}
.eyebrow svg{width:1.02em;height:1.02em;flex:none}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.lead{font-size:clamp(1.05rem,1rem+.5vw,1.25rem);color:var(--muted);line-height:1.6}
.figure{font-size:1.4rem;font-weight:680;color:var(--ink);letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:.3rem 0}
.figure.big{font-size:clamp(2.2rem,1.5rem+3vw,3.2rem);line-height:1.05;
  background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.range-sub{font-size:.95rem;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.fbar{height:6px;border-radius:999px;background:color-mix(in srgb,var(--primary) 12%,transparent);overflow:hidden;margin:.55rem 0 .3rem;max-width:36rem}
.fbar i{display:block;height:100%;border-radius:999px;background:var(--grad)}
.up{color:var(--neg);font-weight:620} .down{color:var(--pos);font-weight:620}
code{font-family:var(--mono);font-size:.85em;background:var(--line-2);color:var(--ink);padding:.14rem .42rem;border-radius:6px;border:1px solid var(--line);word-break:break-word}

/* Tables */
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh-1);margin:.75rem 0;background:var(--surface)}
.table-wrap table{border:none;box-shadow:none;margin:0;border-radius:0;min-width:34rem}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:.9rem;background:var(--surface);
  border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--sh-1);margin:.75rem 0}
th,td{padding:.72rem .95rem;text-align:left;border-bottom:1px solid var(--line-2);vertical-align:top}
th{background:var(--bg-2);font-size:.72rem;font-weight:640;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
td{font-variant-numeric:tabular-nums;color:var(--ink-2)}
tr:last-child td{border-bottom:none}
tbody tr{transition:background .12s var(--ease)}

/* Badges / tiers */
.tier{display:inline-flex;align-items:center;gap:.35rem;font-size:.73rem;font-weight:620;letter-spacing:.005em;
  padding:.22rem .62rem;border-radius:999px;border:1px solid;line-height:1.5;white-space:nowrap}
.tier::before{content:'';width:.42rem;height:.42rem;border-radius:50%;background:currentColor;opacity:.9}
.tier-A{color:var(--pos-ink);background:var(--pos-bg);border-color:var(--pos-line)}
.tier-B{color:var(--warn-ink);background:var(--warn-bg);border-color:var(--warn-line)}
.tier-C{color:var(--neg-ink);background:var(--neg-bg);border-color:var(--neg-line)}
.chip{display:inline-flex;align-items:center;gap:.4rem;font-size:.82rem;font-weight:550;color:var(--muted);
  background:var(--surface-2);border:1px solid var(--line);padding:.3rem .7rem;border-radius:999px;text-decoration:none;
  transition:color .15s var(--ease),border-color .15s var(--ease),background .15s var(--ease)}
a.chip:hover{color:var(--ink);border-color:color-mix(in srgb,var(--primary) 34%,var(--line));background:var(--surface)}

/* details / drill-downs & FAQ */
details{border:1px solid var(--line);border-radius:13px;background:var(--surface);margin:.7rem 0;overflow:hidden;
  box-shadow:var(--sh-1);transition:box-shadow .18s var(--ease)}
details[open]{box-shadow:var(--sh-2)}
summary{cursor:pointer;padding:.85rem 1.05rem;font-weight:600;color:var(--ink);list-style:none;
  display:flex;align-items:center;gap:.6rem;transition:background .15s var(--ease)}
summary::-webkit-details-marker{display:none}
summary::before{content:'';flex:none;width:.5rem;height:.5rem;margin-top:-.12rem;
  border-right:2px solid var(--primary);border-bottom:2px solid var(--primary);
  transform:rotate(-45deg);transition:transform .2s var(--ease)}
details[open] summary::before{transform:rotate(45deg)}
summary:hover{background:var(--surface-2)}
details[open] summary{border-bottom:1px solid var(--line-2)}
details > *:not(summary){margin-inline:1.05rem}
details > *:not(summary):first-of-type{margin-top:.9rem}
details > *:not(summary):last-child{margin-bottom:1rem}

/* Friction cards (report) */
.friction{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:1.35rem 1.5rem;margin:1rem 0;box-shadow:var(--sh-1);
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),border-color .18s var(--ease)}
.friction:hover{transform:translateY(-2px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 20%,var(--line))}
.friction h3{margin:.05rem 0 .55rem;font-size:1.08rem;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.friction .figure{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem}
.friction details{background:var(--bg-2)}

/* Report hero */
.report-hero{background:var(--grad-soft);border:1px solid color-mix(in srgb,var(--primary) 16%,var(--line));
  border-radius:var(--radius-lg);padding:1.9rem 2rem;margin:1.25rem 0 1.75rem;box-shadow:var(--sh-1)}
.report-hero .meta{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}

/* Alerts */
.error{color:var(--neg-ink);background:var(--neg-bg);border:1px solid var(--neg-line);border-radius:12px;padding:.8rem 1.05rem;margin:1rem 0}
.info{color:var(--ink-2);background:var(--grad-soft);border:1px solid color-mix(in srgb,var(--primary) 18%,var(--line));border-radius:12px;padding:.85rem 1.1rem;margin:1rem 0}
.danger{border:1px solid var(--neg-line);background:var(--neg-bg);border-radius:var(--radius);padding:1.1rem 1.35rem;margin:1.35rem 0}
.danger h3{margin-top:0;color:var(--neg-ink)}

/* Empty states */
.empty{text-align:center;padding:2.75rem 1.5rem;border:1px dashed var(--line);border-radius:var(--radius);background:var(--bg-2);margin:1rem 0}
.empty .ic{margin:0 auto 1rem;width:3rem;height:3rem}
.empty .ic svg{width:1.5rem;height:1.5rem}
.empty h3{margin:0 0 .35rem}
.empty p{color:var(--muted);margin:0 auto 1.2rem;max-width:32rem}

/* Row lists (runs) */
.rows{display:flex;flex-direction:column;gap:.6rem;margin:1rem 0;list-style:none;padding:0}
.row{display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.95rem 1.2rem;border:1px solid var(--line);border-radius:13px;background:var(--surface);box-shadow:var(--sh-1);
  transition:transform .16s var(--ease),box-shadow .16s var(--ease),border-color .16s var(--ease)}
.row:hover{transform:translateY(-1px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 22%,var(--line))}
.row a.row-main{color:var(--ink);font-weight:600;text-decoration:none;display:flex;flex-direction:column;gap:.15rem;flex:1}
.row a.row-main:hover{color:var(--ink)}
.row .row-sub{color:var(--muted);font-size:.85rem;font-weight:450}
.row .row-go{color:var(--primary);font-weight:600;font-size:.9rem;white-space:nowrap}

/* Spinner (loading) */
.spinner{width:2.4rem;height:2.4rem;border-radius:50%;border:3px solid color-mix(in srgb,var(--primary) 22%,transparent);
  border-top-color:var(--primary);animation:cf-spin .8s linear infinite;margin:0 auto}
@keyframes cf-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:2s}}

@media (max-width:560px){
  .row{flex-direction:column;align-items:flex-start;gap:.4rem}
  form.inline{flex-wrap:wrap}
}

/* Stepper */
.stepper{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin:0 0 1.9rem;padding:.45rem;
  border:1px solid var(--line);border-radius:15px;background:var(--bg-2);box-shadow:var(--sh-1)}
.stp{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem .75rem;border-radius:11px;
  font-size:.82rem;font-weight:600;color:var(--faint);text-transform:capitalize;transition:all .15s var(--ease)}
.stp .dot{flex:none;width:1.4rem;height:1.4rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  font-size:.7rem;font-weight:700;border:1.5px solid currentColor;background:var(--surface)}
.stp.done{color:var(--pos-ink)} .stp.done .dot{background:var(--pos);border-color:var(--pos);color:#fff}
.stp.cur{color:var(--primary);background:var(--surface);box-shadow:var(--sh-1)}
.stp.cur .dot{background:var(--grad);border-color:transparent;color:#fff}

/* Marketing */
.hero{position:relative;text-align:center;padding:clamp(3.2rem,2rem+7vw,7rem) 0 clamp(2.6rem,2rem+3vw,4.2rem);overflow:hidden}
.hero::before{content:'';position:absolute;inset:-30% -20% auto -20%;height:120%;z-index:-2;pointer-events:none;
  background:radial-gradient(46% 42% at 22% 12%,rgba(99,102,241,.20),transparent 62%),
    radial-gradient(42% 40% at 82% 8%,rgba(168,85,247,.18),transparent 60%),
    radial-gradient(50% 44% at 52% 0%,rgba(59,130,246,.12),transparent 58%)}
.hero::after{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.5;
  background-image:linear-gradient(color-mix(in srgb,var(--ink) 6%,transparent) 1px,transparent 1px),
    linear-gradient(90deg,color-mix(in srgb,var(--ink) 6%,transparent) 1px,transparent 1px);
  background-size:64px 64px;-webkit-mask-image:radial-gradient(60% 60% at 50% 30%,#000,transparent 75%);
  mask-image:radial-gradient(60% 60% at 50% 30%,#000,transparent 75%)}
.hero h1{max-width:22ch;margin-inline:auto}
.hero .lead{max-width:44ch;margin:1.1rem auto 0}
.hero-actions{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-top:1.7rem}
.trust-row{display:flex;gap:.6rem 1.6rem;justify-content:center;flex-wrap:wrap;margin-top:1.7rem;color:var(--muted);font-size:.86rem}
.trust-row span{display:inline-flex;align-items:center;gap:.45rem}
.tick{color:var(--pos)}
.section{padding:clamp(2.6rem,2rem+3.5vw,5rem) 0}
.section-head{text-align:center;max-width:40rem;margin:0 auto 2.4rem}
.section-head .lead{margin-top:.6rem}
.grid{display:grid;gap:1.25rem}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(15.5rem,1fr))}
.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:760px){.grid-2{grid-template-columns:1fr}}
.feature{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem;box-shadow:var(--sh-1);
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),border-color .18s var(--ease)}
.feature:hover{transform:translateY(-3px);box-shadow:var(--sh-2);border-color:color-mix(in srgb,var(--primary) 22%,var(--line))}
.feature h3{margin:.2rem 0 .4rem}
.feature p{margin:0;color:var(--muted);font-size:.94rem}
.ic{display:inline-flex;width:2.6rem;height:2.6rem;align-items:center;justify-content:center;border-radius:13px;
  background:var(--grad-soft);color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);margin-bottom:1rem}
.ic svg{width:1.3rem;height:1.3rem}
.step-num{display:inline-flex;width:2.5rem;height:2.5rem;align-items:center;justify-content:center;border-radius:13px;
  background:var(--grad);color:#fff;font-weight:700;font-size:1.05rem;box-shadow:var(--sh-2);margin-bottom:1rem}
.cta-band{position:relative;overflow:hidden;text-align:center;border-radius:var(--radius-lg);
  padding:clamp(2.4rem,2rem+3vw,3.6rem) 1.5rem;margin:1rem 0;color:#fff;background:var(--grad);box-shadow:var(--sh-3)}
.cta-band::after{content:'';position:absolute;inset:0;z-index:0;opacity:.5;
  background:radial-gradient(40% 80% at 15% 0%,rgba(255,255,255,.28),transparent 60%),radial-gradient(40% 80% at 90% 100%,rgba(255,255,255,.18),transparent 60%)}
.cta-band>*{position:relative;z-index:1}
.cta-band h2{color:#fff}
.cta-band .lead{color:rgba(255,255,255,.86)}
.cta-band .btn{background:#fff;color:var(--primary-2);box-shadow:var(--sh-2)}
.cta-band .btn:hover{color:var(--primary-2);background:#fff}
.site-footer{border-top:1px solid var(--line);margin-top:1rem;padding:2.8rem 0;color:var(--muted);font-size:.9rem;background:var(--bg-2)}
.site-footer a{color:var(--muted)} .site-footer a:hover{color:var(--ink)}
.faq-list{max-width:44rem;margin:0 auto}

@media (max-width:640px){
  body{font-size:16px}
  .nav{gap:.9rem;font-size:.88rem}
  .hero-actions .btn{width:100%}
  .site-header .container{min-height:58px}
}
@media (max-width:560px){ .nav-extra{display:none} }
`;

/**
 * Page shell. When `csrf` is provided (authenticated pages), the shared
 * header carries a CSRF-protected sign-out form so logout is reachable from
 * every authenticated page. Public pages get a marketing header. `opts.bleed`
 * lets a full-bleed marketing page (the landing) manage its own containers.
 */
export function layout(
  title: string,
  body: string,
  csrf?: string,
  opts: { bleed?: boolean } = {},
): string {
  const nav =
    csrf === undefined
      ? `<span class="nav-extra"><a href="/demo">Sample report</a><a href="/login">Sign in</a></span><a class="btn btn-sm" href="/login">Get started</a>`
      : `<a href="/">Home</a><a href="/runs">Runs</a><form method="post" action="/logout" class="signout"><input type="hidden" name="csrf" value="${esc(
          csrf,
        )}"><button type="submit">Sign out</button></form>`;
  const main = opts.bleed
    ? `<main class="bleed">${body}</main>`
    : `<main class="page"><div class="container">${body}</div></main>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} — CostFlow</title>
<meta name="description" content="See what workflow friction is costing your team. Connect Jira and get an itemized, ranked cost report in about a minute — every figure traceable to its formula.">
<link rel="icon" type="image/svg+xml" href="/brand/logo.svg">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0b11">
<meta property="og:site_name" content="CostFlow">
<meta property="og:type" content="website">
<meta property="og:url" content="https://app.fbx1.com/">
<meta property="og:title" content="CostFlow — see what workflow friction is costing your team">
<meta property="og:description" content="Connect Jira and get an itemized, ranked cost report in about a minute — every figure traceable to its formula.">
<meta property="og:image" content="https://app.fbx1.com/og.jpg">
<meta property="og:image:secure_url" content="https://app.fbx1.com/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="CostFlow — see what workflow friction is costing your team">
<meta name="twitter:description" content="Connect Jira and get an itemized, ranked cost report in about a minute — every figure traceable to its formula.">
<meta name="twitter:image" content="https://app.fbx1.com/og.jpg">
<style>${STYLES}</style>
</head>
<body>
<header class="site-header"><div class="container">
  <a class="brand" href="/">${HEADER_MARK}<span>CostFlow</span></a>
  <nav class="nav">${nav}</nav>
</div></header>
${main}
</body>
</html>`;
}

/**
 * Branded, auto-refreshing "analysis running" page. No JS (CSP `script-src
 * none`), so it polls with `<meta http-equiv="refresh">`; the CSS spinner and
 * theme-aware palette keep it on-brand while the job completes.
 */
export function loadingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2">
<meta name="color-scheme" content="light dark">
<title>Analysing… — CostFlow</title>
<style>
  :root{--ink:#0d0e14;--muted:#5c5f6e;--line:#e9e9f0;--bg:#ffffff;--surface:#ffffff;--primary:#5b54e6;
    --grad:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a855f7);
    --sh:0 20px 44px -14px rgba(30,24,74,.22),0 8px 18px -10px rgba(30,24,74,.14);
    --font:'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  @media (prefers-color-scheme:dark){:root{--ink:#f4f5fb;--muted:#9a9db2;--line:#242634;--bg:#0a0b11;--surface:#12141d;--primary:#8b87f5;--sh:0 26px 52px -14px rgba(0,0,0,.72)}}
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font-family:var(--font);background:var(--bg);color:var(--ink);
    display:flex;align-items:center;justify-content:center;padding:1.5rem;-webkit-font-smoothing:antialiased}
  .box{text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:22px;
    padding:2.75rem 2.5rem;box-shadow:var(--sh);max-width:26rem}
  .sp{width:2.6rem;height:2.6rem;border-radius:50%;border:3px solid color-mix(in srgb,var(--primary) 22%,transparent);
    border-top-color:var(--primary);animation:s .8s linear infinite;margin:0 auto 1.4rem}
  @keyframes s{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.sp{animation-duration:2s}}
  h1{font-size:1.35rem;letter-spacing:-.02em;margin:0 0 .4rem}
  p{color:var(--muted);margin:0;font-size:.95rem;line-height:1.55}
  .bar{height:4px;width:8rem;margin:1.4rem auto 0;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--primary) 14%,transparent)}
  .bar::before{content:'';display:block;height:100%;width:40%;border-radius:999px;background:var(--grad);animation:m 1.3s var(--ease,ease-in-out) infinite}
  @keyframes m{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
</style>
</head>
<body>
  <div class="box">
    <div class="sp"></div>
    <h1>Analysing your workflow…</h1>
    <p>Importing work items and pricing friction. This usually takes a few seconds — the page refreshes on its own.</p>
    <div class="bar"></div>
  </div>
</body>
</html>`;
}

const ONBOARDING_STEPS = ['connect', 'scope', 'statuses', 'roles', 'assumptions', 'run'] as const;

/**
 * Onboarding stepper with completed / current / upcoming states, so a
 * first-time user always knows where they are and what's left.
 */
export function stepsNav(current?: (typeof ONBOARDING_STEPS)[number]): string {
  const currentIdx = current ? ONBOARDING_STEPS.indexOf(current) : -1;
  const parts = ONBOARDING_STEPS.map((s, i) => {
    const state = currentIdx < 0 ? '' : i < currentIdx ? 'done' : i === currentIdx ? 'cur' : '';
    const mark = state === 'done' ? '✓' : String(i + 1);
    return `<span class="stp ${state}"${state === 'cur' ? ' aria-current="step"' : ''}><span class="dot">${mark}</span>${s}</span>`;
  }).join('');
  return `<nav class="stepper" aria-label="Onboarding progress">${parts}</nav>`;
}

/** Back-compat default (no step highlighted). */
export const STEPS_NAV = stepsNav();

/**
 * Standalone print/export document (P5): no app chrome, print-optimized CSS,
 * drill-downs rendered expanded by the caller. The user prints to PDF from the
 * browser — no server-side PDF binary dependency. Deliberately uses no
 * `<header>` element (kept chrome-free for the executive export).
 */
export function printLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — CostFlow</title>
<style>
  :root{--ink:#0d0e14;--ink-2:#33353f;--muted:#5c5f6e;--line:#e4e4ea;--line-2:#f0f0f4;
    --grad:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a855f7);
    --pos-ink:#0a7a52;--pos-bg:#e7f7f0;--pos-line:#bfe8d5;--warn-ink:#9a6800;--warn-bg:#fdf6e3;--warn-line:#f0dca6;
    --neg-ink:#c0393e;--neg-bg:#fdecec;--neg-line:#f4c4c6;--neg:#e5484d;--pos:#0ea371;
    --mono:'SF Mono',ui-monospace,Menlo,Consolas,monospace}
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    max-width:52rem;margin:1.75rem auto;padding:0 1.35rem;color:var(--ink-2);line-height:1.6;
    -webkit-font-smoothing:antialiased;font-feature-settings:'cv05','ss01'}
  h1,h2,h3{color:var(--ink);letter-spacing:-.02em;line-height:1.18}
  h1{font-size:1.7rem;letter-spacing:-.03em;margin:.2rem 0 .3rem}
  h2{font-size:1.15rem;border-bottom:1px solid var(--line);padding-bottom:.35rem;margin-top:1.8rem}
  p{margin:0 0 .8rem;text-wrap:pretty}
  .table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin:.6rem 0}
  .table-wrap table{border:none;margin:0}
  table{border-collapse:separate;border-spacing:0;width:100%;margin:.6rem 0;font-size:.84rem;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{border-bottom:1px solid var(--line-2);padding:.5rem .65rem;text-align:left;vertical-align:top}
  th{background:#faf9ff;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:640}
  tr:last-child td{border-bottom:none}
  td{font-variant-numeric:tabular-nums}
  .figure{font-size:1.2rem;font-weight:680;color:var(--ink);font-variant-numeric:tabular-nums}
  .figure.big{font-size:2.2rem;background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .friction{border:1px solid var(--line);border-radius:12px;padding:.85rem 1.1rem;margin:.7rem 0;break-inside:avoid}
  .friction h3{margin:.1rem 0 .4rem;font-size:1.02rem}
  .report-hero{background:#f7f5ff;border:1px solid var(--line);border-radius:14px;padding:1.3rem 1.5rem;margin:1rem 0 1.4rem}
  .report-hero .meta{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem}
  .note{color:var(--muted);font-size:.85rem} .error{color:var(--neg-ink)}
  .tier{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:620;padding:.16rem .55rem;border-radius:999px;border:1px solid;line-height:1.5}
  .tier::before{content:'';width:.4rem;height:.4rem;border-radius:50%;background:currentColor}
  .tier-A{color:var(--pos-ink);background:var(--pos-bg);border-color:var(--pos-line)}
  .tier-B{color:var(--warn-ink);background:var(--warn-bg);border-color:var(--warn-line)}
  .tier-C{color:var(--neg-ink);background:var(--neg-bg);border-color:var(--neg-line)}
  .chip{display:inline-flex;align-items:center;font-size:.8rem;color:var(--muted);background:#f5f5fa;border:1px solid var(--line);padding:.24rem .6rem;border-radius:999px}
  .range-sub{font-size:.82rem;color:var(--muted);font-weight:500}
  .fbar{height:5px;border-radius:999px;background:#ececf2;overflow:hidden;margin:.4rem 0 .3rem;max-width:30rem}
  .fbar i{display:block;height:100%;border-radius:999px;background:var(--grad)}
  .up{color:var(--neg);font-weight:620} .down{color:var(--pos);font-weight:620}
  code{background:#f2f2f6;padding:.12rem .38rem;border-radius:5px;font-family:var(--mono);font-size:.85em}
  details{border:1px solid var(--line);border-radius:10px;margin:.5rem 0;overflow:hidden}
  details > summary{display:none}
  details > *{margin-inline:.9rem} details > *:first-child{margin-top:.7rem} details > *:last-child{margin-bottom:.7rem}
  .appendix{margin-top:1.8rem;font-size:.85rem;color:var(--ink-2);border-top:1px solid var(--line);padding-top:.9rem}
  .doc-toolbar{color:var(--muted);font-size:.85rem;margin-bottom:1rem}
  @media print{a[href]::after{content:""} .noprint{display:none} body{margin:0}}
</style>
</head>
<body>
<p class="noprint doc-toolbar">Use your browser's Print → Save as PDF to export this report.</p>
${body}
</body>
</html>`;
}

/** Fixed methodology appendix for the executive export (P5). */
export const METHODOLOGY_APPENDIX = `<section class="appendix">
  <h2>Methodology</h2>
  <p>Every figure is an estimate expressed as a range: <em>low – high (expected)</em>. Frictions are
  ranked by expected cost, computed deterministically from the imported work items and your stated
  assumptions — the same numbers are reproducible from the run's saved inputs.</p>
  <p><strong>Confidence tiers:</strong> A (fully observed data and customer-confirmed assumptions),
  B and C (progressively more inference or missing inputs — each drill-down states why).</p>
  <p><strong>Assumption provenance:</strong> vendor-suggested (unconfirmed — never priced in report
  mode), accepted by customer, customized by customer, or measured by customer.</p>
  <p><strong>Attribution:</strong> cost is attributed to processes, stages, and roles — never to
  named individuals. Individual identities are pseudonymized before analysis.</p>
</section>`;
