import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import Seo from "@/components/Seo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404: no route for", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <Seo title="Page not found, Swardus" noindex />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">That page does not exist.</p>
        <div className="flex items-center justify-center gap-6">
          <a href="/" className="text-primary underline hover:text-primary/90">Back to the site</a>
          <a href="/app/fields" className="text-primary underline hover:text-primary/90">Your fields</a>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
