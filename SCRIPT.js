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

// ---------- REPLACE the existing updateUserVideoProgress block with this ----------
    if (body?.includes('"operationName":"updateUserVideoProgress"')) {
      try {
        let bodyObj = JSON.parse(body);
        if (bodyObj.variables?.input) {
          const inputVars = bodyObj.variables.input;
          const duration = Number(inputVars.durationSeconds || 0);
          let lastWatched = Number(inputVars.lastSecondWatched || inputVars.secondsWatched || 0);
    
          // nothing to do if duration is invalid or already at/near end
          if (!(duration > 0) || lastWatched >= duration) {
            // forward original request untouched
          } else {
            // Helper: build Request-like args preserving original properties
            const buildArgs = (origInput, origInit, newBody) => {
              // If origInput is Request, copy its properties to a new Request
              if (origInput instanceof Request) {
                const opts = {
                  method: origInput.method,
                  headers: new Headers(origInput.headers),
                  body: newBody,
                  mode: origInput.mode,
                  credentials: origInput.credentials,
                  cache: origInput.cache,
                  redirect: origInput.redirect,
                  referrer: origInput.referrer,
                  referrerPolicy: origInput.referrerPolicy,
                  integrity: origInput.integrity,
                  keepalive: origInput.keepalive,
                };
                return [new Request(origInput.url, opts), undefined];
              } else {
                // origInput is URL/string: use origInit but replace body
                const newInit = Object.assign({}, origInit || {}, { body: newBody });
                return [origInput, newInit];
              }
            };
    
            // incremental chunks to look like natural watching
            const chunkSizeSec = Math.max(10, Math.floor(duration * 0.1)); // 10% or min 10s
            const maxAttempts = 6; // avoid infinite loops; at most send ~6 increments
            let attempt = 0;
            let success = false;
            let lastResponse = null;
    
            while (!success && attempt < maxAttempts) {
              attempt++;
    
              // compute new simulated progress for this attempt
              const simulated = Math.min(duration, lastWatched + chunkSizeSec * attempt);
              inputVars.secondsWatched = Math.floor(simulated);
              inputVars.lastSecondWatched = Math.floor(Math.max(0, simulated - 1));
    
              // near-end marker: if close enough, set exactly to duration
              if (simulated >= duration - 1) {
                inputVars.secondsWatched = duration;
                inputVars.lastSecondWatched = duration;
              }
    
              const newBody = JSON.stringify(bodyObj);
    
              // Build proper args and call the original fetch
              const [newInput, newInit] = buildArgs(input, init, newBody);
    
              try {
                const resp = await originalFetch.call(this, newInput, newInit);
                lastResponse = resp;
    
                // Try to parse JSON and look for GraphQL errors
                let ok = resp.ok;
                let parsed = null;
                try {
                  const txt = await resp.clone().text();
                  parsed = txt ? JSON.parse(txt) : null;
                } catch (e) {
                  parsed = null;
                }
    
                const hasErrors = parsed && parsed.errors && parsed.errors.length;
                if (ok && !hasErrors) {
                  // Server accepted it — stop further attempts
                  success = true;
                  // Small toast to indicate progress accepted
                  if (simulated >= duration) {
                    sendToast("🎬｜Video marked as watched", 1200);
                  } else {
                    sendToast(`⏩｜Progress simulated: ${inputVars.secondsWatched}s / ${duration}s`, 800);
                  }
                  return resp; // return the successful response to the original caller
                } else {
                  // Not accepted — wait a bit and try the next chunk
                  await delay(500 + Math.random() * 400);
                }
              } catch (fetchErr) {
                // network / other error — try again after a short delay
                console.warn("Khan Destroyer fetch error while simulating progress:", fetchErr);
                await delay(300 + Math.random() * 400);
              }
            }
    
            // If we exit loop without success, return the last response if available,
            // otherwise fall through to let originalResponse be returned later.
            if (lastResponse) return lastResponse;
          }
        }
      } catch (e) {
        console.warn("Khan Destroyer video patch error:", e);
        // fallthrough to original response
      }
    }
    // ---------- end replacement ----------


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
