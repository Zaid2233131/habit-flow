// Habit Flow — Authentication
(() => {
  const authGate = document.createElement("div");

  authGate.id = "authGate";

  authGate.innerHTML = `
    <div style="
      width:min(420px, calc(100% - 32px));
      padding:32px;
      border-radius:24px;
      background:#111;
      color:#fff;
      box-shadow:0 20px 80px rgba(0,0,0,.45);
      font-family:inherit;
    ">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="
          width:56px;
          height:56px;
          margin:0 auto 16px;
          border-radius:16px;
          background:#fff;
          color:#111;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:24px;
          font-weight:800;
        ">HF</div>

        <h1 id="authTitle" style="margin:0 0 8px;font-size:26px;">
          Welcome to Habit Flow
        </h1>

        <p id="authSubtitle" style="
          margin:0;
          color:#999;
          font-size:14px;
          line-height:1.5;
        ">
          Sign in to sync your habits across devices.
        </p>
      </div>

      <form id="authForm">

        <label style="
          display:block;
          margin-bottom:7px;
          font-size:13px;
          color:#bbb;
        ">Email</label>

        <input
          id="authEmail"
          type="email"
          placeholder="you@example.com"
          required
          autocomplete="email"
          style="
            width:100%;
            box-sizing:border-box;
            padding:14px 15px;
            margin-bottom:16px;
            border:1px solid #333;
            border-radius:12px;
            background:#1b1b1b;
            color:#fff;
            outline:none;
            font-size:15px;
          "
        >

        <label style="
          display:block;
          margin-bottom:7px;
          font-size:13px;
          color:#bbb;
        ">Password</label>

        <input
          id="authPassword"
          type="password"
          placeholder="At least 6 characters"
          required
          minlength="6"
          autocomplete="current-password"
          style="
            width:100%;
            box-sizing:border-box;
            padding:14px 15px;
            margin-bottom:18px;
            border:1px solid #333;
            border-radius:12px;
            background:#1b1b1b;
            color:#fff;
            outline:none;
            font-size:15px;
          "
        >

        <button
          id="authSubmit"
          type="submit"
          style="
            width:100%;
            padding:14px;
            border:0;
            border-radius:12px;
            background:#fff;
            color:#111;
            font-size:15px;
            font-weight:700;
            cursor:pointer;
          "
        >
          Sign In
        </button>

      </form>

      <div
        id="authMessage"
        style="
          display:none;
          margin-top:16px;
          padding:12px;
          border-radius:10px;
          font-size:13px;
          line-height:1.5;
        "
      ></div>

      <button
        id="authToggle"
        type="button"
        style="
          width:100%;
          margin-top:18px;
          padding:10px;
          border:0;
          background:transparent;
          color:#aaa;
          cursor:pointer;
          font-size:13px;
        "
      >
        Don't have an account? Create one
      </button>

    </div>
  `;

  // Full-screen authentication layer
  Object.assign(authGate.style, {
    position: "fixed",
    inset: "0",
    zIndex: "999999",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#080808",
    padding: "16px",
    boxSizing: "border-box"
  });

  document.body.appendChild(authGate);

  const form = document.getElementById("authForm");
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const submitButton = document.getElementById("authSubmit");
  const toggleButton = document.getElementById("authToggle");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const message = document.getElementById("authMessage");

  let signupMode = false;

  function showMessage(text, success = false) {
    message.style.display = "block";
    message.textContent = text;

    message.style.background = success
      ? "rgba(80,200,120,.12)"
      : "rgba(255,80,80,.12)";

    message.style.color = success
      ? "#7dff9d"
      : "#ff8d8d";
  }

  function clearMessage() {
    message.style.display = "none";
    message.textContent = "";
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.textContent = loading
      ? "Please wait..."
      : signupMode
        ? "Create Account"
        : "Sign In";
  }

  function updateMode() {
    clearMessage();

    if (signupMode) {
      title.textContent = "Create your account";
      subtitle.textContent =
        "Create an account to sync Habit Flow across your devices.";
      submitButton.textContent = "Create Account";
      toggleButton.textContent =
        "Already have an account? Sign in";
    } else {
      title.textContent = "Welcome to Habit Flow";
      subtitle.textContent =
        "Sign in to sync your habits across devices.";
      submitButton.textContent = "Sign In";
      toggleButton.textContent =
        "Don't have an account? Create one";
    }

    passwordInput.autocomplete = signupMode
      ? "new-password"
      : "current-password";
  }

  async function ensureProfile(user) {
    try {
      await supabaseClient
        .from("profiles")
        .upsert(
          {
            id: user.id,
            display_name: user.email
              ? user.email.split("@")[0]
              : "there",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          {
            onConflict: "id"
          }
        );
    } catch (error) {
      console.warn("Profile setup warning:", error);
    }
  }

  async function handleAuth() {
    clearMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      if (signupMode) {

        const { data, error } =
          await supabaseClient.auth.signUp({
            email,
            password
          });

        if (error) throw error;

        if (data.session) {
          await ensureProfile(data.user);

          window.habitFlowUser = data.user;

          authGate.remove();

          if (typeof render === "function") {
            render();
          }

        } else {
          showMessage(
            "Account created. Check your email and confirm your account, then come back and sign in.",
            true
          );
        }

      } else {

        const { data, error } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        if (data.user) {
          await ensureProfile(data.user);

          window.habitFlowUser = data.user;

          authGate.remove();

          if (typeof render === "function") {
            render();
          }
        }
      }

    } catch (error) {

      console.error("Authentication error:", error);

      showMessage(
        error.message || "Something went wrong. Please try again."
      );

    } finally {
      setLoading(false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleAuth();
  });

  toggleButton.addEventListener("click", () => {
    signupMode = !signupMode;
    updateMode();
  });

  async function initializeAuth() {
    try {

      const { data, error } =
        await supabaseClient.auth.getSession();

      if (error) throw error;

      if (data.session && data.session.user) {

  await ensureProfile(data.session.user);

  window.habitFlowUser = data.session.user;

  // Load cloud data after login
  if (typeof loadHabitsFromCloud === "function") {
    await loadHabitsFromCloud();
await loadHabitCompletionsFromCloud();
await loadTasksFromCloud();
await loadSchedulesFromCloud();
  }

  authGate.remove();

  if (typeof render === "function") {
    render();
  }

}

    } catch (error) {

      console.error("Auth initialization error:", error);

      showMessage(
        "Unable to connect to your account. Please refresh the page."
      );
    }
  }

  supabaseClient.auth.onAuthStateChange(
    async (event, session) => {

      if (session && session.user) {

  window.habitFlowUser = session.user;

  await ensureProfile(session.user);

  // Load cloud habits
  if (typeof loadHabitsFromCloud === "function") {
    await loadHabitsFromCloud();
  }

  if (document.body.contains(authGate)) {
    authGate.remove();
  }

  if (typeof render === "function") {
    render();
  }
}
    }
  );

  updateMode();
  initializeAuth();
})();