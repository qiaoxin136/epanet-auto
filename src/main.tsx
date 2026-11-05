import React from "react";
import ReactDOM from "react-dom/client";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import App from "./App.tsx";
import "./index.css";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="amplify-auth-shell">
      <Authenticator
        loginMechanisms={["email"]}
        components={{
          Header() {
            return (
              <div className="amplify-auth-brand-header">
                <div className="amplify-auth-logo">G6</div>
                <div>
                  <div className="amplify-auth-title">
                    EPANET-Auto · GPT-6 Sol
                  </div>
                  <div className="amplify-auth-subtitle">
                    AWS Amplify Login · Amazon Bedrock (openai.gpt-6-sol)
                  </div>
                </div>
              </div>
            );
          },
        }}
      >
        {({ signOut, user }) => <App user={user} signOut={signOut} />}
      </Authenticator>
    </div>
  </React.StrictMode>
);

