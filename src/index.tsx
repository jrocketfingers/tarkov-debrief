import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import MapSelector from "./MapSelector";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { initAnalytics, trackPageView } from "./analytics";

initAnalytics();

function TrackPageView() {
  const [location] = useLocation();
  useEffect(() => {
    trackPageView(location);
  }, [location]);
  return null;
}

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <Router hook={useHashLocation}>
      <TrackPageView />
      <Switch>
        <Route path="/app/:map">{() => <App />}</Route>
        <Route path="/">
          <MapSelector />
        </Route>
      </Switch>
    </Router>
  </React.StrictMode>,
);