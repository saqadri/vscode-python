// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../client/common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as fastDeepEqual from 'fast-deep-equal';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';
import { connect } from 'react-redux';

import { OSType } from '../../client/common/utils/platform';
import { concatMultilineStringInput } from '../../client/datascience/common';
import { Identifiers } from '../../client/datascience/constants';
import { NativeCommandType } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { CellState } from '../../client/datascience/types';
import { CellInput } from '../interactive-common/cellInput';
import { CellOutput } from '../interactive-common/cellOutput';
import { ExecutionCount } from '../interactive-common/executionCount';
import { InformationMessages } from '../interactive-common/informationMessages';
import { CursorPos, ICellViewModel, IFont } from '../interactive-common/mainState';
import { getOSType } from '../react-common/constants';
import { IKeyboardEvent } from '../react-common/event';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import { AddCellLine } from './addCellLine';
import { actionCreators } from './redux/actions';

interface INativeCellBaseProps {
    role?: string;
    cellVM: ICellViewModel;
    baseTheme: string;
    codeTheme: string;
    testMode?: boolean;
    maxTextSize?: number;
    monacoTheme: string | undefined;
    lastCell: boolean;
    firstCell: boolean;
    font: IFont;
    allowUndo: boolean;
    enableGather: boolean | undefined;
    editorOptions: monacoEditor.editor.IEditorOptions;
    themeMatplotlibPlots: boolean | undefined;
}

type INativeCellProps = INativeCellBaseProps & typeof actionCreators;

// tslint:disable: react-this-binding-issue
export class NativeCell extends React.Component<INativeCellProps> {
    private inputRef: React.RefObject<CellInput> = React.createRef<CellInput>();
    private wrapperRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private lastKeyPressed: string | undefined;

    constructor(prop: INativeCellProps) {
        super(prop);
    }

    public render() {
        if (this.props.cellVM.cell.data.cell_type === 'messages') {
            return <InformationMessages messages={this.props.cellVM.cell.data.messages} />;
        } else {
            return this.renderNormalCell();
        }
    }

    public componentDidUpdate(prevProps: INativeCellProps) {
        if (this.props.cellVM.selected && !prevProps.cellVM.selected && !this.props.cellVM.focused) {
            this.giveFocus();
        }

        // Anytime we update, reset the key. This object will be reused for different cell ids
        this.lastKeyPressed = undefined;
    }

    public shouldComponentUpdate(nextProps: INativeCellProps): boolean {
        return !fastDeepEqual(this.props, nextProps);
    }

    // Public for testing
    public getUnknownMimeTypeFormatString() {
        return getLocString('DataScience.unknownMimeTypeFormat', 'Unknown Mime Type');
    }

    private giveFocus() {
        if (this.wrapperRef && this.wrapperRef.current) {
            // Give focus to the cell if not already owning focus
            if (!this.wrapperRef.current.contains(document.activeElement)) {
                this.wrapperRef.current.focus();
            }

            // Scroll into view (since we have focus). However this function
            // is not supported on enzyme
            if (this.wrapperRef.current.scrollIntoView) {
                this.wrapperRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
            }
        }
    }

    private getCell = () => {
        return this.props.cellVM.cell;
    };

    private isCodeCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'code';
    };

    private isMarkdownCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'markdown';
    };

    private isSelected = () => {
        return this.props.cellVM.selected;
    };

    private isFocused = () => {
        return this.props.cellVM.focused;
    };

    private renderNormalCell() {
        const cellOuterClass = this.props.cellVM.editable ? 'cell-outer-editable' : 'cell-outer';
        let cellWrapperClass = this.props.cellVM.editable ? 'cell-wrapper' : 'cell-wrapper cell-wrapper-noneditable';
        if (this.isSelected() && !this.isFocused()) {
            cellWrapperClass += ' cell-wrapper-selected';
        }
        if (this.isFocused()) {
            cellWrapperClass += ' cell-wrapper-focused';
        }

        // Content changes based on if a markdown cell or not.
        const content =
            this.isMarkdownCell() && !this.isShowingMarkdownEditor() ? (
                <div className="cell-result-container">
                    <div className="cell-row-container">
                        {this.renderCollapseBar(false)}
                        {this.renderOutput()}
                    </div>
                    {this.renderAddDivider(false)}
                </div>
            ) : (
                <div className="cell-result-container">
                    <div className="cell-row-container">
                        {this.renderCollapseBar(true)}
                        {this.renderControls()}
                        {this.renderInput()}
                    </div>
                    {this.renderAddDivider(true)}
                    <div className="cell-row-container">
                        {this.renderCollapseBar(false)}
                        {this.renderOutput()}
                    </div>
                </div>
            );

        return (
            <div
                className={cellWrapperClass}
                role={this.props.role}
                ref={this.wrapperRef}
                tabIndex={0}
                onKeyDown={this.onOuterKeyDown}
                onClick={this.onMouseClick}
                onDoubleClick={this.onMouseDoubleClick}
            >
                <div className={cellOuterClass}>
                    {this.renderNavbar()}
                    <div className="content-div">{content}</div>
                </div>
            </div>
        );
    }

    private onMouseClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        if (ev.nativeEvent.target) {
            const elem = ev.nativeEvent.target as HTMLElement;
            if (!elem.className.includes || !elem.className.includes('image-button')) {
                // Not a click on an button in a toolbar, select the cell.
                ev.stopPropagation();
                this.lastKeyPressed = undefined;
                this.props.selectCell(this.cellId);
            }
        }
    };

    private onMouseDoubleClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        // When we receive double click, propagate upwards. Might change our state
        ev.stopPropagation();
        this.props.focusCell(this.cellId, CursorPos.Current);
    };

    private shouldRenderCodeEditor = (): boolean => {
        return this.isCodeCell() && (this.props.cellVM.inputBlockShow || this.props.cellVM.editable);
    };

    private shouldRenderMarkdownEditor = (): boolean => {
        return this.isMarkdownCell() && (this.isShowingMarkdownEditor() || this.props.cellVM.cell.id === Identifiers.EditCellId);
    };

    private isShowingMarkdownEditor = (): boolean => {
        return this.isMarkdownCell() && this.props.cellVM.focused;
    };

    private shouldRenderInput(): boolean {
        return this.shouldRenderCodeEditor() || this.shouldRenderMarkdownEditor();
    }

    private hasOutput = () => {
        return this.getCell().state === CellState.finished || this.getCell().state === CellState.error || this.getCell().state === CellState.executing;
    };

    private getCodeCell = () => {
        return this.props.cellVM.cell.data as nbformat.ICodeCell;
    };

    private shouldRenderOutput(): boolean {
        if (this.isCodeCell()) {
            const cell = this.getCodeCell();
            return this.hasOutput() && cell.outputs && !this.props.cellVM.hideOutput && Array.isArray(cell.outputs) && cell.outputs.length !== 0;
        } else if (this.isMarkdownCell()) {
            return !this.isShowingMarkdownEditor();
        }
        return false;
    }

    // tslint:disable-next-line: cyclomatic-complexity max-func-body-length
    private keyDownInput = (cellId: string, e: IKeyboardEvent) => {
        const isFocusedWhenNotSuggesting = this.isFocused() && e.editorInfo && !e.editorInfo.isSuggesting;
        switch (e.code) {
            case 'ArrowUp':
            case 'k':
                if ((isFocusedWhenNotSuggesting && e.editorInfo!.isFirstLine && !e.shiftKey) || !this.isFocused()) {
                    this.arrowUpFromCell(e);
                }
                break;
            case 'ArrowDown':
            case 'j':
                if ((isFocusedWhenNotSuggesting && e.editorInfo!.isLastLine && !e.shiftKey) || !this.isFocused()) {
                    this.arrowDownFromCell(e);
                }
                break;
            case 's':
                if ((e.ctrlKey && getOSType() !== OSType.OSX) || (e.metaKey && getOSType() === OSType.OSX)) {
                    // This is save, save our cells
                    this.props.save();
                }
                break;

            case 'Escape':
                if (isFocusedWhenNotSuggesting) {
                    this.escapeCell(e);
                }
                break;
            case 'y':
                if (!this.isFocused() && this.isSelected() && this.isMarkdownCell()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.changeCellType(cellId, this.getCurrentCode());
                    this.props.sendCommand(NativeCommandType.ChangeToCode, 'keyboard');
                }
                break;
            case 'm':
                if (!this.isFocused() && this.isSelected() && this.isCodeCell()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.changeCellType(cellId, this.getCurrentCode());
                    this.props.sendCommand(NativeCommandType.ChangeToMarkdown, 'keyboard');
                }
                break;
            case 'l':
                if (!this.isFocused() && this.isSelected()) {
                    e.stopPropagation();
                    this.props.toggleLineNumbers(cellId);
                    this.props.sendCommand(NativeCommandType.ToggleLineNumbers, 'keyboard');
                }
                break;
            case 'o':
                if (!this.isFocused() && this.isSelected()) {
                    e.stopPropagation();
                    this.props.toggleOutput(cellId);
                    this.props.sendCommand(NativeCommandType.ToggleOutput, 'keyboard');
                }
                break;
            case 'Enter':
                if (e.shiftKey) {
                    this.shiftEnterCell(e);
                } else if (e.ctrlKey) {
                    this.ctrlEnterCell(e);
                } else if (e.altKey) {
                    this.altEnterCell(e);
                } else {
                    this.enterCell(e);
                }
                break;
            case 'd':
                if (this.lastKeyPressed === 'd' && !this.isFocused() && this.isSelected()) {
                    e.stopPropagation();
                    this.lastKeyPressed = undefined; // Reset it so we don't keep deleting
                    this.props.deleteCell(cellId);
                    this.props.sendCommand(NativeCommandType.DeleteCell, 'keyboard');
                }
                break;
            case 'a':
                if (!this.isFocused()) {
                    e.stopPropagation();
                    this.props.insertAbove(cellId);
                    this.props.sendCommand(NativeCommandType.InsertAbove, 'keyboard');
                }
                break;
            case 'b':
                if (!this.isFocused()) {
                    e.stopPropagation();
                    this.props.insertBelow(cellId);
                    this.props.sendCommand(NativeCommandType.InsertBelow, 'keyboard');
                }
                break;
            case 'z':
            case 'Z':
                if (!this.isFocused()) {
                    if (e.shiftKey && !e.ctrlKey && !e.altKey) {
                        e.stopPropagation();
                        this.props.redo();
                        this.props.sendCommand(NativeCommandType.Redo, 'keyboard');
                    } else if (!e.shiftKey && !e.altKey && !e.ctrlKey) {
                        e.stopPropagation();
                        this.props.undo();
                        this.props.sendCommand(NativeCommandType.Undo, 'keyboard');
                    }
                }
                break;

            default:
                break;
        }

        this.lastKeyPressed = e.code;
    };

    private get cellId(): string {
        return this.props.cellVM.cell.id;
    }

    private escapeCell = (e: IKeyboardEvent) => {
        // Unfocus the current cell by giving focus to the cell itself
        if (this.wrapperRef && this.wrapperRef.current && this.isFocused()) {
            e.stopPropagation();
            this.wrapperRef.current.focus();
            this.props.sendCommand(NativeCommandType.Unfocus, 'keyboard');
        }
    };

    private arrowUpFromCell = (e: IKeyboardEvent) => {
        e.stopPropagation();
        e.preventDefault();
        this.props.arrowUp(this.cellId, this.getCurrentCode());
        this.props.sendCommand(NativeCommandType.ArrowUp, 'keyboard');
    };

    private arrowDownFromCell = (e: IKeyboardEvent) => {
        e.stopPropagation();
        e.preventDefault();
        this.props.arrowDown(this.cellId, this.getCurrentCode());
        this.props.sendCommand(NativeCommandType.ArrowDown, 'keyboard');
    };

    private enterCell = (e: IKeyboardEvent) => {
        // If focused, then ignore this call. It should go to the focused cell instead.
        if (!this.isFocused() && !e.editorInfo && this.wrapperRef && this.wrapperRef && this.isSelected()) {
            e.stopPropagation();
            e.preventDefault();
            this.props.focusCell(this.cellId, CursorPos.Current);
        }
    };

    private shiftEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Submit and move to the next.
        this.runAndMove(e.editorInfo ? e.editorInfo.contents : undefined);

        this.props.sendCommand(NativeCommandType.RunAndMove, 'keyboard');
    };

    private altEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Submit this cell
        this.runAndAdd(e.editorInfo ? e.editorInfo.contents : undefined);

        this.props.sendCommand(NativeCommandType.RunAndAdd, 'keyboard');
    };

    private runAndMove(possibleContents?: string) {
        // Submit this cell
        this.submitCell(possibleContents, this.props.lastCell ? 'add' : 'select');
    }

    private runAndAdd(possibleContents?: string) {
        // Submit this cell
        this.submitCell(possibleContents, 'add');
    }

    private ctrlEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Submit this cell
        this.submitCell(e.editorInfo ? e.editorInfo.contents : undefined, 'none');
        this.props.sendCommand(NativeCommandType.Run, 'keyboard');
    };

    private submitCell = (possibleContents: string | undefined, moveOp: 'add' | 'select' | 'none') => {
        let content: string | undefined;

        // If inside editor, submit this code
        if (possibleContents !== undefined) {
            content = possibleContents;
        } else {
            // Outside editor, just use the cell
            content = concatMultilineStringInput(this.props.cellVM.cell.data.source);
        }

        // Send to jupyter
        if (content) {
            this.props.executeCell(this.cellId, content, moveOp);
        }
    };

    private addNewCell = () => {
        this.props.insertBelow(this.cellId);
        this.props.sendCommand(NativeCommandType.AddToEnd, 'mouse');
    };

    private renderNavbar = () => {
        const moveUp = () => {
            this.props.moveCellUp(this.cellId);
            this.props.sendCommand(NativeCommandType.MoveCellUp, 'mouse');
        };
        const moveDown = () => {
            this.props.moveCellDown(this.cellId);
            this.props.sendCommand(NativeCommandType.MoveCellDown, 'mouse');
        };
        const addButtonRender = !this.props.lastCell ? (
            <div className="navbar-add-button">
                <ImageButton baseTheme={this.props.baseTheme} onClick={this.addNewCell} tooltip={getLocString('DataScience.insertBelow', 'Insert cell below')}>
                    <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.InsertBelow} />
                </ImageButton>
            </div>
        ) : null;

        return (
            <div className="navbar-div">
                <div>
                    <ImageButton baseTheme={this.props.baseTheme} onClick={moveUp} disabled={this.props.firstCell} tooltip={getLocString('DataScience.moveCellUp', 'Move cell up')}>
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Up} />
                    </ImageButton>
                </div>
                <div>
                    <ImageButton
                        baseTheme={this.props.baseTheme}
                        onClick={moveDown}
                        disabled={this.props.lastCell}
                        tooltip={getLocString('DataScience.moveCellDown', 'Move cell down')}
                    >
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Down} />
                    </ImageButton>
                </div>
                {addButtonRender}
            </div>
        );
    };

    private renderAddDivider = (checkOutput: boolean) => {
        // Skip on the last cell
        if (!this.props.lastCell) {
            // Divider should only show if no output
            if (!checkOutput || !this.shouldRenderOutput()) {
                return <AddCellLine className="add-divider" baseTheme={this.props.baseTheme} includePlus={false} click={this.addNewCell} />;
            }
        }

        return null;
    };

    private getCurrentCode(): string {
        // Input may not be open at this time. If not, then use current cell contents.
        const contents = this.inputRef.current ? this.inputRef.current.getContents() : undefined;
        return contents || concatMultilineStringInput(this.props.cellVM.cell.data.source);
    }

    private renderMiddleToolbar = () => {
        const cellId = this.props.cellVM.cell.id;
        const runCell = () => {
            this.runAndMove(this.getCurrentCode());
            this.props.sendCommand(NativeCommandType.Run, 'mouse');
        };
        const gatherCell = () => {
            this.props.gatherCell(cellId);
        };
        const deleteCell = () => {
            this.props.deleteCell(cellId);
            this.props.sendCommand(NativeCommandType.DeleteCell, 'mouse');
        };
        const gatherDisabled =
            this.props.cellVM.cell.data.execution_count === null ||
            this.props.cellVM.hasBeenRun === null ||
            this.props.cellVM.hasBeenRun === false ||
            this.isMarkdownCell() ||
            this.props.enableGather === false;
        const switchTooltip =
            this.props.cellVM.cell.data.cell_type === 'code'
                ? getLocString('DataScience.switchToMarkdown', 'Change to markdown')
                : getLocString('DataScience.switchToCode', 'Change to code');
        const otherCellType = this.props.cellVM.cell.data.cell_type === 'code' ? 'markdown' : 'code';
        const otherCellTypeCommand = otherCellType === 'markdown' ? NativeCommandType.ChangeToMarkdown : NativeCommandType.ChangeToCode;
        const otherCellImage = otherCellType === 'markdown' ? ImageName.SwitchToMarkdown : ImageName.SwitchToCode;
        const switchCellType = (event: React.MouseEvent<HTMLButtonElement>) => {
            // Prevent this mouse click from stealing focus so that we
            // can give focus to the cell input.
            event.stopPropagation();
            event.preventDefault();
            this.props.changeCellType(cellId, this.getCurrentCode());
            this.props.sendCommand(otherCellTypeCommand, 'mouse');
        };
        const toolbarClassName = this.props.cellVM.cell.data.cell_type === 'code' ? '' : 'markdown-toolbar';

        return (
            <div className={toolbarClassName}>
                <div className="native-editor-celltoolbar-middle">
                    <ImageButton baseTheme={this.props.baseTheme} onClick={runCell} tooltip={getLocString('DataScience.runCell', 'Run cell')} hidden={this.isMarkdownCell()}>
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Run} />
                    </ImageButton>
                    <ImageButton baseTheme={this.props.baseTheme} onMouseDown={switchCellType} tooltip={switchTooltip}>
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={otherCellImage} />
                    </ImageButton>
                    <ImageButton
                        baseTheme={this.props.baseTheme}
                        onClick={gatherCell}
                        tooltip={getLocString('DataScience.gatherCell', 'Gather the code required to generate this cell into a new notebook')}
                        hidden={gatherDisabled}
                        className="hover-cell-button"
                    >
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.GatherCode} />
                    </ImageButton>
                    <ImageButton
                        baseTheme={this.props.baseTheme}
                        onClick={deleteCell}
                        tooltip={getLocString('DataScience.deleteCell', 'Delete cell')}
                        className="delete-cell-button hover-cell-button"
                    >
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Delete} />
                    </ImageButton>
                </div>
                <div className="native-editor-celltoolbar-divider" />
            </div>
        );
    };

    private renderControls = () => {
        const busy = this.props.cellVM.cell.state === CellState.init || this.props.cellVM.cell.state === CellState.executing;
        const executionCount =
            this.props.cellVM && this.props.cellVM.cell && this.props.cellVM.cell.data && this.props.cellVM.cell.data.execution_count
                ? this.props.cellVM.cell.data.execution_count.toString()
                : '-';

        return (
            <div className="controls-div">
                <ExecutionCount isBusy={busy} count={executionCount} visible={this.isCodeCell()} />
            </div>
        );
    };

    private renderInput = () => {
        if (this.shouldRenderInput()) {
            return (
                <div>
                    {this.renderMiddleToolbar()}
                    <CellInput
                        cellVM={this.props.cellVM}
                        editorOptions={this.props.editorOptions}
                        history={undefined}
                        codeTheme={this.props.codeTheme}
                        onCodeChange={this.onCodeChange}
                        onCodeCreated={this.onCodeCreated}
                        testMode={this.props.testMode ? true : false}
                        showWatermark={false}
                        ref={this.inputRef}
                        monacoTheme={this.props.monacoTheme}
                        openLink={this.openLink}
                        editorMeasureClassName={undefined}
                        focused={this.onCodeFocused}
                        unfocused={this.onCodeUnfocused}
                        keyDown={this.keyDownInput}
                        showLineNumbers={this.props.cellVM.showLineNumbers}
                        font={this.props.font}
                    />
                </div>
            );
        }
        return null;
    };

    private onCodeFocused = () => {
        this.props.focusCell(this.cellId, CursorPos.Current);
    };

    private onCodeUnfocused = () => {
        // Make sure to save the code from the editor into the cell
        this.props.unfocusCell(this.cellId, this.getCurrentCode());
    };

    private onCodeChange = (changes: monacoEditor.editor.IModelContentChange[], cellId: string, modelId: string) => {
        this.props.editCell(cellId, changes, modelId);
    };

    private onCodeCreated = (_code: string, _file: string, cellId: string, modelId: string) => {
        this.props.codeCreated(cellId, modelId);
    };

    private renderOutput = (): JSX.Element | null => {
        const themeMatplotlibPlots = this.props.themeMatplotlibPlots ? true : false;
        const toolbar = this.props.cellVM.cell.data.cell_type === 'markdown' ? this.renderMiddleToolbar() : null;
        if (this.shouldRenderOutput()) {
            return (
                <div>
                    {toolbar}
                    <CellOutput
                        cellVM={this.props.cellVM}
                        baseTheme={this.props.baseTheme}
                        expandImage={this.props.showPlot}
                        maxTextSize={this.props.maxTextSize}
                        themeMatplotlibPlots={themeMatplotlibPlots}
                    />
                </div>
            );
        }
        return null;
    };

    private onOuterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Handle keydown events for the entire cell when we don't have focus
        if (event.key !== 'Tab' && !this.isFocused()) {
            this.keyDownInput(this.props.cellVM.cell.id, {
                code: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                target: event.target as HTMLDivElement,
                stopPropagation: () => event.stopPropagation(),
                preventDefault: () => event.preventDefault()
            });
        }
    };

    private renderCollapseBar = (input: boolean) => {
        let classes = 'collapse-bar';

        if (this.isSelected() && !this.isFocused()) {
            classes += ' collapse-bar-selected';
        }
        if (this.isFocused()) {
            classes += ' collapse-bar-focused';
        }

        if (input) {
            return <div className={classes}></div>;
        }

        if (this.props.cellVM.cell.data.cell_type === 'markdown') {
            classes += ' collapse-bar-markdown';
        } else if (Array.isArray(this.props.cellVM.cell.data.outputs) && this.props.cellVM.cell.data.outputs.length !== 0) {
            classes += ' collapse-bar-output';
        } else {
            return null;
        }

        return <div className={classes}></div>;
    };

    private openLink = (uri: monacoEditor.Uri) => {
        this.props.linkClick(uri.toString());
    };
}

// Main export, return a redux connected editor
export function getConnectedNativeCell() {
    return connect(null, actionCreators)(NativeCell);
}
