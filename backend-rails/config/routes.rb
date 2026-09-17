Rails.application.routes.draw do
  get "/actuator/health", to: "health#show"
  scope "/api" do
    get "rules", to: "rules#index"
    post "rules", to: "rules#create"
    get "rules/:id", to: "rules#show"
    put "rules/:id", to: "rules#update"
    post "rules/:id/publish", to: "rules#publish"
    get "rules/:id/versions", to: "rules#versions"
    get "rules/:id/versions/:version", to: "rules#version"
    post "rules/:id/execute", to: "rules#execute"
    post "preview", to: "studio#preview"
    post "validate", to: "studio#validate_graph"
    post "variables", to: "studio#variables"
    post "diagnostics", to: "studio#diagnostics"
    get "functions", to: "studio#functions"
    post "studio/build", to: "studio#build"
    post "studio/render", to: "studio#render_graph"
    post "studio/node/build", to: "studio#build_node"
    post "studio/node/render", to: "studio#render_node"
    get "sources", to: "sources#index"
    post "sources", to: "sources#create"
    put "sources/:id", to: "sources#update"
    get "sources/:id/versions", to: "sources#versions"
    get "sources/:id/versions/:version", to: "sources#version"
    post "sources/:id/test", to: "sources#test_source"
  end
  match "*path", to: "health#missing", via: :all
end
