import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import Shell from "./Shell";
import Library from "./screens/Library";
import BibleEditor from "./screens/BibleEditor";
import ChapterBoard from "./screens/ChapterBoard";
import PageReview from "./screens/PageReview";
import StoryReader from "./screens/StoryReader";
import ExportScreen from "./screens/Export";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000 } } });

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Library /> },
      { path: "series/:seriesId/bible", element: <BibleEditor /> },
      { path: "series/:seriesId/chapters", element: <ChapterBoard /> },
      { path: "series/:seriesId/:ch/pages/:idx", element: <PageReview /> },
      { path: "series/:seriesId/:ch/story", element: <StoryReader /> },
      { path: "series/:seriesId/export", element: <ExportScreen /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
