import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Library } from "./pages/Library";
import { BibleEditor } from "./pages/BibleEditor";
import { ChapterBoard } from "./pages/ChapterBoard";
import { PageReview } from "./pages/PageReview";
import { StoryReader } from "./pages/StoryReader";
import { ExportPage } from "./pages/ExportPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Library />} />
        <Route path="/series/:id/bible" element={<BibleEditor />} />
        <Route path="/series/:id/chapters" element={<ChapterBoard />} />
        <Route path="/series/:id/pages/:pageId" element={<PageReview />} />
        <Route path="/series/:id/story/:chapterId" element={<StoryReader />} />
        <Route path="/series/:id/export" element={<ExportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
