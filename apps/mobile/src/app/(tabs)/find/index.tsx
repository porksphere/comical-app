import SearchScreen from '@/app/search';

/** iOS's search tab (`app-tabs.ios`): the Search screen as a tab of its own. Nothing links here
 *  elsewhere, where search is a page pushed from Browse. */
export default function SearchTab() {
  return <SearchScreen tab />;
}
