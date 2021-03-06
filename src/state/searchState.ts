import * as vscode from 'vscode';
import { Position } from './../motion/position';
import { TextEditor } from './../textEditor';
import { Configuration } from '../../src/configuration/configuration';

export enum SearchDirection {
  Forward = 1,
  Backward = -1
}

/**
 * State involved with beginning a search (/).
 */
export class SearchState {
  private static readonly MAX_SEARCH_RANGES = 1000;
  private static specialCharactersRegex: RegExp = /[\-\[\]{}()*+?.,\\\^$|#\s]/g;

  private _matchRanges: vscode.Range[] = [];

  /**
   * Every range in the document that matches the search string.
   */
  public get matchRanges(): vscode.Range[] {
    return this._matchRanges;
  }

  private _searchCursorStartPosition: Position;
  public get searchCursorStartPosition(): Position {
    return this._searchCursorStartPosition;
  }

  private _cachedDocumentVersion: number;
  private _cachedDocumentName: String;
  private _searchDirection: SearchDirection = SearchDirection.Forward;
  private isRegex: boolean;

  private _searchString = "";
  public get searchString(): string {
    return this._searchString;
  }

  public set searchString(search: string){
    if (this._searchString !== search) {
      this._searchString = search;
      this._recalculateSearchRanges({ forceRecalc: true });
    }
  }

  private _recalculateSearchRanges({ forceRecalc }: { forceRecalc?: boolean } = {}): void {
    const search = this.searchString;
    const selection = vscode.window.activeTextEditor!.selection;
    const lineToStartAt = Math.min(selection.start.line, selection.end.line);

    if (search === "") { return; }

    // checking if the tab that is worked on has changed, or the file version has changed
    const shouldRecalculate = (this._cachedDocumentName !== TextEditor.getDocumentName()) ||
      (this._cachedDocumentVersion !== TextEditor.getDocumentVersion()) || forceRecalc;
    if (shouldRecalculate) {
      // Calculate and store all matching ranges
      this._cachedDocumentVersion = TextEditor.getDocumentVersion();
      this._cachedDocumentName = TextEditor.getDocumentName();
      this._matchRanges = [];

      /*
       * Decide whether the search is case sensitive.
       * If ignorecase is false, the search is case sensitive.
       * If ignorecase is true, the search should be case insensitive.
       * If both ignorecase and smartcase are true, the search is case sensitive only when the search string contains UpperCase character.
       */
      let ignorecase = Configuration.ignorecase;

      if (ignorecase && Configuration.smartcase && /[A-Z]/.test(search)) {
        ignorecase = false;
      }

      let searchRE = search;
      if (!this.isRegex) {
        searchRE = search.replace(SearchState.specialCharactersRegex, "\\$&");
      }

      const regexFlags = ignorecase ? 'gi' : 'g';

      let regex: RegExp;
      try {
        regex = new RegExp(searchRE, regexFlags);
      } catch (err) {
        // Couldn't compile the regexp, try again with special characters escaped
        searchRE = search.replace(SearchState.specialCharactersRegex, "\\$&");
        regex = new RegExp(searchRE, regexFlags);
      }

      let lineIdx = lineToStartAt;

      // Start at the current line and wrap the document if we hit the end.
      outer:
      do {
        const line = TextEditor.getLineAt(new Position(lineIdx, 0)).text;
        let result = regex.exec(line);

        while (result) {
          if (this._matchRanges.length >= SearchState.MAX_SEARCH_RANGES) {
            break outer;
          }

          this.matchRanges.push(new vscode.Range(
            new Position(lineIdx, result.index),
            new Position(lineIdx, result.index + result[0].length)
          ));

          if (result.index === regex.lastIndex) {
            regex.lastIndex++;
          }

          result = regex.exec(line);
        }

        lineIdx === TextEditor.getLineCount() - 1 ? lineIdx = 0 : lineIdx++;
      } while (lineIdx !== lineToStartAt);

      this._matchRanges.sort((x, y) =>
        x.start.line < y.start.line ||
        x.start.line === y.start.line && x.start.character < y.start.character ? -1 : 1);
    }
  }

  /**
   * The position of the next search, or undefined if there is no match.
   *
   * Pass in -1 as direction to reverse the direction we search.
   */
  public getNextSearchMatchPosition(startPosition: Position, direction = 1): { pos: Position, match: boolean } {
    this._recalculateSearchRanges();

    if (this._matchRanges.length === 0) {
      // TODO(bell)
      return { pos: startPosition, match: false };
    }

    const effectiveDirection = direction * this._searchDirection;

    if (effectiveDirection === SearchDirection.Forward) {
      for (let matchRange of this._matchRanges) {
        if (matchRange.start.compareTo(startPosition) > 0) {
          return { pos: Position.FromVSCodePosition(matchRange.start), match: true };
        }
      }

      // Wrap around
      // TODO(bell)
      return { pos: Position.FromVSCodePosition(this._matchRanges[0].start), match: true };
    } else {
      for (let matchRange of this._matchRanges.slice(0).reverse()) {
        if (matchRange.start.compareTo(startPosition) < 0) {
          return { pos: Position.FromVSCodePosition(matchRange.start), match: true };
        }
      }

      // TODO(bell)
      return {
        pos: Position.FromVSCodePosition(this._matchRanges[this._matchRanges.length - 1].start),
        match: true
      };
    }
  }

  constructor(direction: SearchDirection, startPosition: Position, searchString = "", { isRegex = false } = {}) {
    this._searchDirection = direction;
    this._searchCursorStartPosition = startPosition;
    this.isRegex = isRegex;
    this.searchString = searchString;
  }
}
