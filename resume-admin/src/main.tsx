import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { createAdminAuthClient, createAdminSupabaseClient } from "./auth/supabase";
import { createResumeRepository } from "./data/resumeRepository";
import "./styles.css";
import { UiLocaleProvider } from "./uiLocale";

const supabase = createAdminSupabaseClient();
const authClient = supabase ? createAdminAuthClient(supabase) : null;
const resumeRepository = supabase ? createResumeRepository(supabase) : null;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <UiLocaleProvider><AuthGate client={authClient} resumeRepository={resumeRepository} /></UiLocaleProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
