let loadedPlugins = [];

console.clear();
const noop = () => {};
console.warn = console.error = window.debug = noop;

// Create splash screen element
const splashScreen = document.createElement('div');

class EventEmitter {
  constructor() { this.events = {}; }
  on(t, e) {
    (Array.isArray(t) ? t : [t]).forEach(t => {
      (this.events[t] = this.events[t] || []).push(e);
    });
  }
  off(t, e) {
    (Array.isArray(t) ? t : [t]).forEach(t => {
      this.events[t] && (this.events[t] = this.events[t].filter(h => h !== e));
    });
  }
  emit(t, ...e) {
    this.events[t]?.forEach(h => h(...e));
  }
  once(t, e) {
    const s = (...i) => { e(...i); this.off(t, s); };
    this.on(t, s);
  }
}

const plppdo = new EventEmitter();

// DOM observer
new MutationObserver(mutationsList =>
  mutationsList.some(m => m.type === 'childList') && plppdo.emit('domChanged')
).observe(document.body, { childList: true, subtree: true });

// Helpers
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function sendToast(text, duration = 5000, gravity = 'bottom') {
  if (typeof Toastify !== "undefined") {
    Toastify({
      text,
      duration,
      gravity,
      position: "center",
      stopOnFocus: true,
      style: { background: "#000000" }
    }).showToast();
  } else {
    console.log("Toast:", text);
  }
}

async function showSplashScreen() {
  splashScreen.id = "khan-splash";
  splashScreen.style.cssText = `
    position:fixed;
    top:0;left:0;
    width:100%;height:100%;
    background-color:white;
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:9999;
    opacity:0;
    transition:opacity 0.5s ease;
    user-select:none;
    color:black;
    font-family:MuseoSans,sans-serif;
    font-size:30px;
    text-align:center;
  `;
  splashScreen.innerHTML = '<span style="color:black;">KHAN</span><span style="color:#2ecc71;">DESTROYER</span>';
  document.body.appendChild(splashScreen);
  requestAnimationFrame(() => splashScreen.style.opacity = '1');
}

async function hideSplashScreen() {
  splashScreen.style.opacity = '0';
  setTimeout(() => splashScreen.remove(), 800);
}

async function loadScript(url, label) {
  const response = await fetch(url);
  const script = await response.text();
  loadedPlugins.push(label);
  eval(script);
}

async function loadCss(url) {
  return new Promise(resolve => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = resolve;
    document.head.appendChild(link);
  });
}

function setupMain() {
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    let body;
    if (input instanceof Request) {
      body = await input.clone().text();
    } else if (init?.body) {
      body = init.body;
    }

    // Auto-complete video watching progress
    if (body?.includes('"operationName":"updateUserVideoProgress"')) {
      try {
        let bodyObj = JSON.parse(body);
        if (bodyObj.variables?.input) {
          const durationSeconds = bodyObj.variables.input.durationSeconds;
          bodyObj.variables.input.secondsWatched = durationSeconds;
          bodyObj.variables.input.lastSecondWatched = durationSeconds;
          body = JSON.stringify(bodyObj);

          if (input instanceof Request) {
            input = new Request(input, { body });
          } else {
            init.body = body;
          }

          sendToast("🔄｜Exploited video.", 1000);
        }
      } catch (e) {}
    }

    const originalResponse = await originalFetch.apply(this, arguments);

    try {
      const clonedResponse = originalResponse.clone();
      const responseBody = await clonedResponse.text();
      let responseObj = JSON.parse(responseBody);

      // Modify question to show correct choice, but not auto-answer
      if (responseObj?.data?.assessmentItem?.item?.itemData) {
        let itemData = JSON.parse(responseObj.data.assessmentItem.item.itemData);

        // try to get the actual question text (handle arrays or strings)
        let originalQuestion = itemData?.question?.content;
        let questionText = "";

        try {
          if (Array.isArray(originalQuestion)) {
            // If content is array of strings/objects, try to join text parts
            questionText = originalQuestion.map(part => {
              if (typeof part === "string") return part;
              // some content parts may be objects with text or html - attempt to stringify sensibly
              if (part?.text) return part.text;
              if (typeof part === "object") try { return JSON.stringify(part); } catch { return "";}
              return "";
            }).join(" ").trim();
          } else if (typeof originalQuestion === "string") {
            questionText = originalQuestion;
          } else {
            // fallback: try to stringify
            questionText = JSON.stringify(originalQuestion || "").slice(0, 1000);
          }
        } catch (e) {
          questionText = "Question";
        }

        // Only modify certain items (keep your previous uppercase check to limit changes)
        if (questionText && questionText[0] === questionText[0].toUpperCase()) {

          // Prepare choices array: attempt to reuse existing choices if available
          let newChoices = [];
          let usedCorrectIndex = -1;

          try {
            // detect existing widget choices
            const widgets = itemData.question.widgets || {};
            // try to find the first widget that looks like choices
            const widgetKeys = Object.keys(widgets);
            let foundChoices = null;
            for (const k of widgetKeys) {
              const w = widgets[k];
              if (w?.options?.choices && Array.isArray(w.options.choices)) {
                foundChoices = w.options.choices;
                break;
              }
            }

            if (foundChoices && foundChoices.length >= 1) {
              // Use up to 4 existing choices, but transform text to "Wrong answer X" except preserve correctness label
              for (let i = 0; i < 4; i++) {
                const src = foundChoices[i];
                if (src) {
                  const text = (typeof src.content === "string") ? src.content : (src?.text || `Choice ${i+1}`);
                  const isCorrect = !!src.correct;
                  newChoices.push({ content: isCorrect ? "✅ Correct answer" : `Wrong answer ${i+1}`, correct: isCorrect });
                  if (isCorrect) usedCorrectIndex = i;
                } else {
                  // fill missing with placeholder
                  newChoices.push({ content: `Wrong answer ${i+1}`, correct: false });
                }
              }
              // if none flagged correct, mark last as correct
              if (!newChoices.some(c => c.correct)) {
                newChoices[newChoices.length - 1].correct = true;
                newChoices[newChoices.length - 1].content = "✅ Correct answer";
              } else {
                // ensure only one correct: if multiple, keep the first correct and unset others
                let found = false;
                for (let i = 0; i < newChoices.length; i++) {
                  if (newChoices[i].correct) {
                    if (!found) { found = true; newChoices[i].content = "✅ Correct answer"; }
                    else { newChoices[i].correct = false; newChoices[i].content = `Wrong answer ${i+1}`; }
                  }
                }
              }
            } else {
              // No existing choices -> create 3 wrong + 1 correct
              newChoices = [
                { content: "Wrong answer 1", correct: false },
                { content: "Wrong answer 2", correct: false },
                { content: "Wrong answer 3", correct: false },
                { content: "✅ Correct answer", correct: true }
              ];
            }
          } catch (e) {
            // fallback
            newChoices = [
              { content: "Wrong answer 1", correct: false },
              { content: "Wrong answer 2", correct: false },
              { content: "Wrong answer 3", correct: false },
              { content: "✅ Correct answer", correct: true }
            ];
          }

          // Build a fresh widget with the new choices
          const radioWidget = {
            type: "radio",
            options: {
              choices: newChoices.map(c => ({ content: c.content, correct: !!c.correct }))
            }
          };

          // Replace question content with the real question and inject our radio widget
          // Use the original question text as-is (keeps the actual question)
          itemData.question.content = (questionText || "Question") + ` [[☃ radio 1]]`;
          itemData.question.widgets = {
            "radio 1": radioWidget
          };

          // turn off heavy answer areas if present (keep behavior from before)
          itemData.answerArea = {
            calculator: false,
            chi2Table: false,
            periodicTable: false,
            tTable: false,
            zTable: false
          };

          responseObj.data.assessmentItem.item.itemData = JSON.stringify(itemData);

          return new Response(JSON.stringify(responseObj), {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers: originalResponse.headers
          });
        }
      }
    } catch (e) {
      // parsing/modify error - silently continue and return originalResponse below
      console.error("Khan Destroyer modify error:", e);
    }

    return originalResponse;
  };

  // Removed auto-clicker — user now clicks manually
}

if (!/^https?:\/\/([a-z0-9-]+\.)?khanacademy\.org/.test(window.location.href)) {
  window.location.href = "https://pt.khanacademy.org/";
} else {
  (async function init() {
    await showSplashScreen();

    // Load Toastify and CSS before proceeding
    await Promise.all([
      loadCss("https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css"),
      loadScript("https://cdn.jsdelivr.net/npm/toastify-js", "toastifyPlugin")
    ]);

    // Show splash for 2s minimum
    await delay(2000);
    await hideSplashScreen();

    setupMain();
    sendToast("Khan Destroyer initiated");
    console.clear();
  })();
}
