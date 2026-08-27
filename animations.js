/* =========================================================
   소학행을 위한 자산 플래너 v12 — animations.js
   [고급 애니메이션 · 순수 바닐라 · 외부 CDN/GSAP 불필요]
   · 사내망에서 CDN이 차단돼도 100% 동작 (의존성 zero)
   · app.js / styles.css 무수정 — DOM 이벤트로만 후킹
   · 오로라 배경 div 도 스스로 생성 (index.html에 없어도 됨)
   [FIX] OS의 'reduce-motion(동작 줄이기)'이 켜져 있어도 앱 자체 토글로 제어.
         기본값 = 켜짐. 상단에 ✨ 애니메이션 토글 버튼 자동 추가.
         (사용자 선택은 localStorage에 저장 · OS 설정보다 우선)
========================================================= */
(function () {
    "use strict";
    console.log("🎬 animations.js 실행됨 (vanilla, no-CDN)");

    var LS_KEY = "animEnabled_v12";
    var osReduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    /* 저장된 사용자 선택이 있으면 그것을 최우선. 없으면 기본 '켜짐'(OS 설정 무시) */
    var saved = null; try { saved = localStorage.getItem(LS_KEY); } catch (e) { }
    var animOn = (saved === null) ? true : (saved === "1");
    if (osReduce) console.log("ℹ️ OS 'reduce-motion' 켜져 있음 — 하지만 앱 토글(기본 켜짐)로 재생합니다");

    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

    /* ---------- 0) 스타일 + 오로라 배경 주입 ---------- */
    (function injectCss() {
        var css = `
        .aurora{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;filter:blur(72px);opacity:.34}
        html[data-theme="dark"] .aurora{opacity:.30}
        body.anim-off .aurora{display:none}
        .aurora .ab{position:absolute;border-radius:50%;mix-blend-mode:screen;will-change:transform}
        .aurora .ab1{width:44vw;height:44vw;background:var(--a,#3f7fd1);top:-12%;left:-8%;animation:abFloat1 11s ease-in-out infinite}
        .aurora .ab2{width:40vw;height:40vw;background:var(--aqua,#4fc4d6);top:6%;right:-14%;animation:abFloat2 13s ease-in-out infinite}
        .aurora .ab3{width:42vw;height:42vw;background:var(--peri,#6f7fe0);bottom:-16%;left:22%;animation:abFloat3 15s ease-in-out infinite}
        @keyframes abFloat1{0%,100%{transform:translate(0,0)}50%{transform:translate(48px,34px)}}
        @keyframes abFloat2{0%,100%{transform:translate(0,0)}50%{transform:translate(-38px,44px)}}
        @keyframes abFloat3{0%,100%{transform:translate(0,0)}50%{transform:translate(34px,-30px)}}
        .anim-in{opacity:0;transform:translateY(24px)}
        .anim-in.anim-run{opacity:1;transform:translateY(0);transition:opacity .55s cubic-bezier(.22,.61,.36,1),transform .55s cubic-bezier(.22,.61,.36,1)}
        .anim-pop{animation:animPop .42s cubic-bezier(.34,1.56,.64,1)}
        @keyframes animPop{0%{transform:scale(.9)}60%{transform:scale(1.06)}100%{transform:scale(1)}}
        .cal-cell.anim-cell{opacity:0;transform:scale(.82)}
        .cal-cell.anim-cell.anim-run{opacity:1;transform:scale(1);transition:opacity .38s ease,transform .38s ease}
        .modal.anim-modal{animation:animModal .34s cubic-bezier(.22,.61,.36,1)}
        @keyframes animModal{0%{opacity:0;transform:translateY(20px) scale(.975)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @media (hover:hover) and (pointer:fine){
          .tab-panel .card,.kpi{transition:transform .25s ease, box-shadow .25s ease}
          .tab-panel > .card:hover,.grid2 > .card:hover,.kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
        }
        /* ✨ 애니메이션 토글 버튼 */
        #animToggle.on{background:var(--peri,#6f7fe0);border-color:var(--peri,#6f7fe0);color:#fff}
        `;
        var st = document.createElement("style"); st.setAttribute("data-anim", "vanilla"); st.textContent = css;
        document.head.appendChild(st);

        if (!document.querySelector(".aurora")) {
            var a = document.createElement("div"); a.className = "aurora"; a.setAttribute("aria-hidden", "true");
            a.innerHTML = '<span class="ab ab1"></span><span class="ab ab2"></span><span class="ab ab3"></span>';
            document.body.insertBefore(a, document.body.firstChild);
        }
    })();

    /* ---------- 0.5) 상단에 ✨ 애니메이션 토글 버튼 자동 삽입 ---------- */
    function insertToggle() {
        var bar = document.querySelector(".top-actions"); if (!bar || document.getElementById("animToggle")) return;
        var btn = document.createElement("button");
        btn.id = "animToggle"; btn.className = "btn" + (animOn ? " on" : "");
        btn.title = "화면 애니메이션 켜기/끄기";
        btn.textContent = animOn ? "✨ 애니메이션" : "✨ 애니메이션 OFF";
        var themeBtn = document.getElementById("themeBtn");
        if (themeBtn) bar.insertBefore(btn, themeBtn); else bar.appendChild(btn);
        btn.addEventListener("click", function () {
            animOn = !animOn;
            try { localStorage.setItem(LS_KEY, animOn ? "1" : "0"); } catch (e) { }
            btn.classList.toggle("on", animOn);
            btn.textContent = animOn ? "✨ 애니메이션" : "✨ 애니메이션 OFF";
            document.body.classList.toggle("anim-off", !animOn);
            if (animOn) { introDone = false; runIntro(); }
            console.log("✨ 애니메이션 " + (animOn ? "켜짐" : "꺼짐"));
        });
    }

    /* ---------- 1) 숫자 카운트업 ---------- */
    var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
    function fmtEok(v) {
        var sign = v < 0 ? "-" : ""; var a = Math.abs(Math.round(v));
        if (a >= 1e8) { var s = (a / 1e8).toFixed(2).replace(/\.?0+$/, ""); return sign + s + "억"; }
        if (a >= 1e4) { return sign + Math.round(a / 1e4).toLocaleString("ko-KR") + "만"; }
        return sign + a.toLocaleString("ko-KR") + "원";
    }
    function fmtFlow(v) { return (v >= 0 ? "＋" : "－") + fmtEok(Math.abs(v)); }
    function parseKoNum(str) {
        if (str == null) return null; str = String(str).trim();
        if (str === "" || str === "-") return null;
        var neg = /^[－-]/.test(str);
        var s = str.replace(/[＋－\-\s,]/g, "");
        var val;
        if (/억$/.test(s)) val = parseFloat(s.replace("억", "")) * 1e8;
        else if (/만$/.test(s)) val = parseFloat(s.replace("만", "")) * 1e4;
        else if (/원$/.test(s)) val = parseFloat(s.replace("원", ""));
        else val = parseFloat(s);
        if (isNaN(val)) return null;
        return neg ? -Math.abs(val) : val;
    }
    function countUp(el, formatter, dur) {
        if (!el) return;
        var target = parseKoNum(el.textContent);
        if (target === null || !isFinite(target)) return;
        if (!animOn) { el.textContent = formatter(target); return; }
        dur = dur || 1300;
        var start = null;
        function step(ts) {
            if (start === null) start = ts;
            var p = Math.min((ts - start) / dur, 1);
            el.textContent = formatter(target * easeOutCubic(p));
            if (p < 1) raf(step); else el.textContent = formatter(target);
        }
        raf(step);
    }
    function countUpHome() {
        ["heroNet", "heroAsset", "heroDebt", "kNetA", "kNetB", "kMonthPay"].forEach(function (id) {
            countUp(document.getElementById(id), fmtEok);
        });
        countUp(document.getElementById("heroFlow"), fmtFlow);
    }

    /* ---------- 2) 패널 등장 ---------- */
    function topBlocks(root) {
        return Array.prototype.slice.call(root.querySelectorAll(".kpi, .card")).filter(function (n) {
            var p = n.parentElement ? n.parentElement.closest(".card") : null; return !p;
        });
    }
    function runReveal(el, delay) {
        if (!animOn) return;
        el.classList.remove("anim-run"); el.classList.add("anim-in");
        void el.offsetWidth;
        setTimeout(function () { el.classList.add("anim-run"); }, delay);
        setTimeout(function () { el.classList.remove("anim-in", "anim-run"); el.style.opacity = ""; el.style.transform = ""; }, delay + 750);
    }
    function revealPanel(panelId) {
        if (!animOn) return;
        var panel = document.getElementById(panelId); if (!panel) return;
        topBlocks(panel).forEach(function (el, i) { runReveal(el, i * 55); });
        if (panelId === "tab-calendar") {
            var cells = panel.querySelectorAll("#calBody .cal-cell:not(.empty)");
            Array.prototype.forEach.call(cells, function (c, i) {
                c.classList.add("anim-cell"); void c.offsetWidth;
                setTimeout(function () { c.classList.add("anim-run"); }, i * 7);
                setTimeout(function () { c.classList.remove("anim-cell", "anim-run"); }, i * 7 + 500);
            });
        }
        if (panelId === "tab-growth") {
            panel.querySelectorAll(".goal-bar > span").forEach(function (b) {
                var w = b.style.width; b.style.width = "0"; void b.offsetWidth;
                b.style.transition = "width 1s cubic-bezier(.22,.61,.36,1)";
                setTimeout(function () { b.style.width = w; }, 200);
                setTimeout(function () { b.style.transition = ""; }, 1300);
            });
        }
    }

    /* ---------- 3) 버튼 팝 ---------- */
    function popBtn(el) { if (!animOn || !el) return; el.classList.remove("anim-pop"); void el.offsetWidth; el.classList.add("anim-pop"); setTimeout(function () { el.classList.remove("anim-pop"); }, 460); }

    /* ---------- 4) 탭 · 하위탭 후킹 ---------- */
    document.querySelectorAll("#mainTabs .tab-btn").forEach(function (b) {
        b.addEventListener("click", function () {
            var id = "tab-" + b.dataset.tab;
            raf(function () { revealPanel(id); popBtn(b); if (b.dataset.tab === "home") countUpHome(); });
        });
    });
    document.querySelectorAll(".subtab-btn").forEach(function (b) {
        b.addEventListener("click", function () { raf(function () { revealPanel("tab-" + b.dataset.sub); popBtn(b); }); });
    });

    /* ---------- 5) 모달 등장 ---------- */
    ["loanModal", "schedModal", "goalModal"].forEach(function (id) {
        var m = document.getElementById(id); if (!m) return;
        new MutationObserver(function () {
            if (animOn && m.classList.contains("on")) {
                var box = m.querySelector(".modal");
                if (box) { box.classList.remove("anim-modal"); void box.offsetWidth; box.classList.add("anim-modal"); }
            }
        }).observe(m, { attributes: true, attributeFilter: ["class"] });
    });

    /* ---------- 6) 최초 진입 연출 (readyState 무관 · 3중 안전망) ---------- */
    var introDone = false;
    function runIntro() {
        if (introDone) return; introDone = true;
        insertToggle();
        document.body.classList.toggle("anim-off", !animOn);
        if (!animOn) { console.log("✨ 애니메이션 꺼짐 상태 — 정적 표시"); return; }
        console.log("✨ 첫 진입 연출 실행");
        [".topbar", ".hero", "#mainTabs"].forEach(function (sel, i) {
            var el = document.querySelector(sel); if (el) runReveal(el, i * 90);
        });
        setTimeout(function () { revealPanel("tab-home"); countUpHome(); }, 150);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runIntro);
    else raf(runIntro);
    setTimeout(runIntro, 450);
})();
