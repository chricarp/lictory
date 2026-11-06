"use client";

import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useStaticSearch } from "fumadocs-core/search/client";
import { useEffect } from "react";

import { track } from "@lictory/core/lib/analytics/client";

// The site is a static export: the browser downloads the prebuilt index once
// (src/app/search.json) and searches it locally. No search request leaves it,
// and analytics record only that search was used and which page was chosen,
// never the query.
export default function StaticSearchDialog(props: SharedProps) {
  const search = useStaticSearch({ from: "/search.json" });
  useEffect(() => {
    if (props.open) track("docs_search_opened");
  }, [props.open]);
  return (
    <SearchDialog
      {...search}
      {...props}
      onSelect={(item) => {
        if ("url" in item)
          track("docs_search_result_selected", {
            path: new URL(item.url, location.origin).pathname,
          });
      }}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}
