// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { 
    NotebookDocument,
    Position,
    Range, 
    TextDocument, 
    Uri, 
    workspace,
    DocumentSelector,
    Event,
    EventEmitter,
    Location,
    TextLine
} from 'vscode';
import { NotebookConcatTextDocument } from 'vscode-proposed';

import { IVSCodeNotebook } from '../../common/application/types';


export interface IConcatTextDocument {
    onDidChange: Event<void>;
    isClosed: boolean;
    getText(range?: Range): string;
    contains(uri: Uri): boolean;
    offsetAt(position: Position): number;
    positionAt(locationOrOffset: Location | number): Position;
    validateRange(range: Range): Range;
    validatePosition(position: Position): Position;
    locationAt(positionOrRange: Position | Range): Location;
    lineAt(posOrNumber: Position | number): TextLine;
    getWordRangeAtPosition(position: Position, regexp?: RegExp | undefined): Range | undefined;
}

export class InteractiveConcatTextDocument implements IConcatTextDocument  {
    private _onDidChange = new EventEmitter<void>();
    onDidChange: Event<void> = this._onDidChange.event;
    private _input: TextDocument | undefined = undefined;

    private _concatTextDocument: NotebookConcatTextDocument;
    private _lineCounts: [number, number] = [0, 0];
    private _textLen: [number, number] = [0, 0];

    get isClosed(): boolean {
        return this._concatTextDocument.isClosed;
    }
    constructor(
        private _notebook: NotebookDocument,
        private _selector: DocumentSelector,
        notebookApi: IVSCodeNotebook,
    ) {
        this._concatTextDocument = notebookApi.createConcatTextDocument(_notebook, this._selector);

        this._concatTextDocument.onDidChange(() => {
            // not performant, NotebookConcatTextDocument should provide lineCount
            this._updateConcat();
            this._onDidChange.fire();
        });

        workspace.onDidChangeTextDocument(e => {
            if (e.document === this._input) {
                this._updateInput();
                this._onDidChange.fire();
            }
        });

        this._updateConcat();
        this._updateInput();

        const once = workspace.onDidOpenTextDocument(e => {
            if (e.uri.scheme === 'vscode-interactive-input') {
                const counter = /Interactive-(\d+)\.interactive/.exec(this._notebook.uri.path);
                if (!counter || !counter[1]) {
                    return;
                }

                if (e.uri.path.indexOf(`InteractiveInput-${counter[1]}`) >= 0) {
                    this._input = e;
                    this._updateInput();
                    once.dispose();
                }
            }
        });
    }

    private _updateConcat() {
        let concatLineCnt = 0;
        let concatTextLen = 0;
        for (let i = 0; i < this._notebook.cellCount; i++) {
            const cell = this._notebook.cellAt(i);
            if (cell.document.languageId === 'python') {
                concatLineCnt += cell.document.lineCount + 1;
                concatTextLen += this._getDocumentTextLen(cell.document) + 1;
            }
        }

        this._lineCounts = [
            concatLineCnt > 0 ? concatLineCnt - 1 : 0, // NotebookConcatTextDocument.lineCount
            this._lineCounts[1]
        ];

        this._textLen = [
            concatTextLen > 0 ? concatTextLen - 1 : 0,
            this._textLen[1]
        ];
    }

    private _updateInput() {
        this._lineCounts = [
            this._lineCounts[0],
            this._input?.lineCount ?? 0
        ];

        this._textLen = [
            this._textLen[0],
            this._getDocumentTextLen(this._input)
        ];
    }

    private _getDocumentTextLen(textDocument?: TextDocument) {
        if (!textDocument) {
            return 0;
        }
        return textDocument.offsetAt(textDocument.lineAt(textDocument.lineCount - 1).range.end) + 1;

    }

    getText(range?: Range) {
        if (!range) {
            let result = '';
            result += this._concatTextDocument.getText() + '\n' + (this._input?.getText() ?? '');
            return result;
        }

        if (range.isEmpty) {
            return '';
        }

        const start = this.locationAt(range.start);
        const end = this.locationAt(range.end);

        const startDocument = workspace.textDocuments.find(document => document.uri.toString() === start.uri.toString());
        const endDocument = workspace.textDocuments.find(document => document.uri.toString() === end.uri.toString());

        if (!startDocument || !endDocument) {
            return '';
        } else if (startDocument === endDocument) {
            return startDocument.getText(start.range);
        } else {
            const a = startDocument.getText(new Range(start.range.start, new Position(startDocument.lineCount, 0)));
            const b = endDocument.getText(new Range(new Position(0, 0), end.range.end));
            return a + '\n' + b;
        }
    }

    offsetAt(position: Position): number {
        const line = position.line;
        if (line >= this._lineCounts[0]) {
            // input box
            const lineOffset = Math.max(0, line - this._lineCounts[0] - 1);
            return this._input?.offsetAt(new Position(lineOffset, position.character)) ?? 0;
        } else {
            // concat
            return this._concatTextDocument.offsetAt(position);
        }
    }

    // turning an offset on the final concatenatd document to position
    positionAt(locationOrOffset: Location | number): Position {
        if (typeof locationOrOffset === 'number') {
            const concatTextLen = this._textLen[0];

            if (locationOrOffset >= concatTextLen) {
                // in the input box
                const offset = Math.max(0, locationOrOffset - concatTextLen - 1);
                return this._input?.positionAt(offset) ?? new Position(0, 0);
            } else {
                const position = this._concatTextDocument.positionAt(locationOrOffset);
                return new Position(this._lineCounts[0] + 1 + position.line, position.character);
            }
        }

        if (locationOrOffset.uri.toString() === this._input?.uri.toString()) {
            // range in the input box
            return new Position(this._lineCounts[0] + 1 + locationOrOffset.range.start.line, locationOrOffset.range.start.character);
        } else {
            return this._concatTextDocument.positionAt(locationOrOffset);
        }
    }

    locationAt(positionOrRange: Range | Position): Location {
        if (positionOrRange instanceof Position) {
            positionOrRange = new Range(positionOrRange, positionOrRange);
        }

        const start = positionOrRange.start.line;
        if (start >= this._lineCounts[0]) {
            // this is the inputbox
            const offset = Math.max(0, start - this._lineCounts[0] - 1);
            const startPosition = new Position(offset, positionOrRange.start.character);
            const endOffset = Math.max(0, positionOrRange.end.line - this._lineCounts[0] - 1);
            const endPosition = new Position(endOffset, positionOrRange.end.character);

            // TODO@rebornix !
            return new Location(this._input!.uri, new Range(startPosition, endPosition));
        } else {
            // this is the NotebookConcatTextDocument
            return this._concatTextDocument.locationAt(positionOrRange);
        }
    }

    contains(uri: Uri): boolean {
        if (this._input?.uri.toString() === uri.toString()) {
            return true;
        }

        return this._concatTextDocument.contains(uri);
    }

    validateRange(range: Range): Range {
        return range;
    }

    validatePosition(position: Position): Position {
        return position;
    }

    lineAt(posOrNumber: Position | number): TextLine {
        const position = typeof posOrNumber === 'number' ? new Position(posOrNumber, 0) : posOrNumber;

        // convert this position into a cell location
        // (we need the translated location, that's why we can't use getCellAtPosition)
        const location = this._concatTextDocument.locationAt(position);

        // Get the cell at this location
        if (location.uri.toString() === this._input?.uri.toString()) {
            return this._input.lineAt(location.range.start);
        }

        const cell = this._notebook.getCells().find((c) => c.document.uri.toString() === location.uri.toString());
        return cell!.document.lineAt(location.range.start);
    }

    getWordRangeAtPosition(position: Position, regexp?: RegExp | undefined): Range | undefined {
        // convert this position into a cell location
        // (we need the translated location, that's why we can't use getCellAtPosition)
        const location = this._concatTextDocument.locationAt(position);

        if (location.uri.toString() === this._input?.uri.toString()) {
            return this._input.getWordRangeAtPosition(location.range.start, regexp);
        }

        // Get the cell at this location
        const cell = this._notebook.getCells().find((c) => c.document.uri.toString() === location.uri.toString());
        return cell!.document.getWordRangeAtPosition(location.range.start, regexp);
    }
}

export class EnhancedNotebookConcatTextDocument implements IConcatTextDocument {
    private _onDidChange = new EventEmitter<void>();
    onDidChange: Event<void> = this._onDidChange.event;
    private _concatTextDocument: NotebookConcatTextDocument;

    constructor(
        private _notebook: NotebookDocument,
        selector: DocumentSelector,
        notebookApi: IVSCodeNotebook,
    ) {
        this._concatTextDocument = notebookApi.createConcatTextDocument(_notebook, selector);
    }

    get isClosed(): boolean {
        return this._concatTextDocument.isClosed;
    }

    getText(range?: Range | undefined): string {
        if (range) {
            return this._concatTextDocument.getText(range);
        } else {
            return this._concatTextDocument.getText();
        }
    }

    contains(uri: Uri): boolean {
        return this._concatTextDocument.contains(uri);
    }

    offsetAt(position: Position): number {
        return this._concatTextDocument.offsetAt(position);
    }

    positionAt(locationOrOffset: Location | number): Position {
        if (typeof locationOrOffset === 'number') {
            return this._concatTextDocument.positionAt(locationOrOffset);
        } else {
            return this._concatTextDocument.positionAt(locationOrOffset);
        }
    }

    validateRange(range: Range): Range {
        return this._concatTextDocument.validateRange(range);
    }
    validatePosition(position: Position): Position {
        return this._concatTextDocument.validatePosition(position);
    }

    locationAt(positionOrRange: Position | Range): Location {
        return this._concatTextDocument.locationAt(positionOrRange);
    }

    lineAt(posOrNumber: Position | number): TextLine {
        const position = typeof posOrNumber === 'number' ? new Position(posOrNumber, 0) : posOrNumber;

        // convert this position into a cell location
        // (we need the translated location, that's why we can't use getCellAtPosition)
        const location = this._concatTextDocument.locationAt(position);

        // Get the cell at this location
        const cell = this._notebook.getCells().find((c) => c.document.uri.toString() === location.uri.toString());
        return cell!.document.lineAt(location.range.start);
    }

    getWordRangeAtPosition(position: Position, regexp?: RegExp | undefined): Range | undefined {
        // convert this position into a cell location
        // (we need the translated location, that's why we can't use getCellAtPosition)
        const location = this._concatTextDocument.locationAt(position);

        // Get the cell at this location
        const cell = this._notebook.getCells().find((c) => c.document.uri.toString() === location.uri.toString());
        return cell!.document.getWordRangeAtPosition(location.range.start, regexp);
    }

}