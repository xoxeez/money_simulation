/* =========================================================
   소학행을 위한 자산 플래너 v12 — animations.js  [GSAP 고급 애니메이션]
   · app.js / styles.css 를 수정하지 않고 DOM 이벤트로만 후킹 (독립 모듈)
   · GSAP 미로드 시 자동 우아하게 무력화(no-op), 앱 동작에는 영향 없음
   · prefers-reduced-motion 존중 (멀미 민감 사용자 자동 비활성)
   · 밝음/어둠 모드 · 데스크톱/모바일 모두 대응
   [연출] 1) 히어로/KPI 숫자 카운트업  2) 탭·하위탭 전환 스태거 등장
          3) 캘린더 셀·게이지 팝인  4) 오로라 배경 드리프트
          5) 모달 등장  6) 탭/버튼 터치 마이크로 인터랙션
========================================================= */
(function () {
    "use strict";
    var G = window.gsap || null;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (G && window.ScrollTrigger) { try { G.registerPlugin(window.ScrollTrigger); } catch (e) { } }

    /* ---------- 0) 자체 스타일 주입 (aurora · 호버 리프트 등) ---------- */
    (function injectCss() {
        var css = `
        .aurora{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;filter:blur(70px);opacity:.34}
        html[data-theme="dark"] .aurora{opacity:.30}
        .aurora .ab{position:absolute;border-radius:50%;mix-blend-mode:screen;will-change:transform}
        .aurora .ab1{width:44vw;height:44vw;background:var(--a);top:-12%;left:-8%}
        .aurora .ab2{width:40vw;height:40vw;background:var(--aqua);top:6%;right:-14%}
        .aurora .ab3{width:42vw;height:42vw;background:var(--peri);bottom:-16%;left:22%}
        @media (hover:hover) and (pointer:fine){
          .tab-panel .card{transition:transform .25s ease, box-shadow .25s ease}
          .tab-panel > .card:hover, .grid2 > .card:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
          .kpi{transition:transform .25s ease, box-shadow .25s ease}
          .kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
        }
        .tab-btn, .subtab-btn{will-change:transform}
        @media (prefers-reduced-motion:reduce){ .aurora{display:none} }
        `;
        var st = document.createElement("style"); st.setAttribute("data-anim", "gsap"); st.textContent = css;
        document.head.appendChild(st);
    })();

    if (!G || reduce) {
        /* GSAP 없거나 모션 최소화 → 정적으로 안전하게 종료 (앱 기능은 그대로) */
        return;
    }

    /* ---------- 1) 숫자 카운트업 ---------- */
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
        var obj = { v: 0 };
        G.killTweensOf(obj);
        G.to(obj, {
            v: target, duration: dur || 1.35, ease: "power2.out",
            onUpdate: function () { el.textContent = formatter(obj.v); },
            onComplete: function () { el.textContent = formatter(target); }
        });
    }
    function countUpHome() {
        ["heroNet", "heroAsset", "heroDebt", "kNetA", "kNetB", "kMonthPay"].forEach(function (id) {
            countUp(document.getElementById(id), fmtEok);
        });
        countUp(document.getElementById("heroFlow"), fmtFlow);
    }

    /* ---------- 2) 패널/하위패널 등장 (스태거 리빌) ---------- */
    function topBlocks(root) {
        var nodes = Array.prototype.slice.call(root.querySelectorAll(".kpi, .card"));
        return nodes.filter(function (n) {
            var p = n.parentElement ? n.parentElement.closest(".card") : null;
            return !p; /* 카드 안의 카드(중첩)는 제외해 이중 애니메이션 방지 */
        });
    }
    function revealPanel(panelId) {
        var panel = document.getElementById(panelId); if (!panel) return;
        var blocks = topBlocks(panel);
        if (blocks.length) G.from(blocks, { opacity: 0, y: 26, duration: .6, ease: "power3.out", stagger: .06, clearProps: "all" });
        /* 특수 연출: 캘린더 셀 · 게이지 · 목표 바 */
        if (panelId === "tab-calendar") {
            var cells = panel.querySelectorAll("#calBody .cal-cell:not(.empty)");
            if (cells.length) G.from(cells, { opacity: 0, scale: .82, duration: .4, ease: "power2.out", stagger: .006, clearProps: "all" });
        }
        if (panelId === "tab-growth") {
            var gauges = panel.querySelectorAll("#healthGrid .gauge");
            if (gauges.length) G.from(gauges, { opacity: 0, y: 18, scale: .92, duration: .55, ease: "back.out(1.6)", stagger: .08, clearProps: "all", delay: .1 });
            var bars = panel.querySelectorAll(".goal-bar > span");
            bars.forEach(function (b) { var w = b.style.width; G.fromTo(b, { width: 0 }, { width: w, duration: 1, ease: "power2.out", delay: .2 }); });
        }
    }

    /* ---------- 3) 버튼 터치 마이크로 인터랙션 ---------- */
    function popBtn(el) { if (el) G.fromTo(el, { scale: .9 }, { scale: 1, duration: .4, ease: "back.out(3)", clearProps: "transform" }); }

    /* ---------- 4) 메인 탭 · 하위 탭 후킹 (app.js 리스너 이후 실행) ---------- */
    document.querySelectorAll("#mainTabs .tab-btn").forEach(function (b) {
        b.addEventListener("click", function () {
            var id = "tab-" + b.dataset.tab;
            requestAnimationFrame(function () {
                revealPanel(id);
                popBtn(b);
                if (b.dataset.tab === "home") countUpHome();
            });
        });
    });
    document.querySelectorAll(".subtab-btn").forEach(function (b) {
        b.addEventListener("click", function () {
            var id = "tab-" + b.dataset.sub;
            requestAnimationFrame(function () { revealPanel(id); popBtn(b); });
        });
    });

    /* ---------- 5) 모달 등장 (loan/sched/goal) ---------- */
    ["loanModal", "schedModal", "goalModal"].forEach(function (id) {
        var m = document.getElementById(id); if (!m) return;
        new MutationObserver(function () {
            if (m.classList.contains("on")) {
                var box = m.querySelector(".modal");
                if (box) G.fromTo(box, { y: 20, opacity: 0, scale: .975 }, { y: 0, opacity: 1, scale: 1, duration: .35, ease: "power3.out", clearProps: "transform" });
            }
        }).observe(m, { attributes: true, attributeFilter: ["class"] });
    });

    /* ---------- 6) 오로라 배경 은은한 드리프트 ---------- */
    (function aurora() {
        if (!document.querySelector(".aurora")) return;
        G.to(".ab1", { x: 48, y: 32, duration: 10, yoyo: true, repeat: -1, ease: "sine.inOut" });
        G.to(".ab2", { x: -36, y: 44, duration: 12.5, yoyo: true, repeat: -1, ease: "sine.inOut" });
        G.to(".ab3", { x: 34, y: -30, duration: 14, yoyo: true, repeat: -1, ease: "sine.inOut" });
    })();

    /* ---------- 7) 최초 진입 연출 ---------- */
    window.addEventListener("load", function () {
        G.from(".topbar", { opacity: 0, y: -16, duration: .7, ease: "power2.out" });
        G.from(".hero", { opacity: 0, y: 18, duration: .7, ease: "power3.out", delay: .05 });
        G.from("#mainTabs", { opacity: 0, y: 12, duration: .6, ease: "power2.out", delay: .12 });
        requestAnimationFrame(function () { revealPanel("tab-home"); countUpHome(); });
    });
})();
