// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, computed, observable } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { Component, KeyboardEvent, memo, ReactNode } from 'react';
import { Badge, css, Hi, Icon, ResizeHandle } from './widgets';
import './table.scss';
import { Column, RowGroup, RowItem, TableStore } from './tableStore';
import { ResultStatus } from '../shared';

// Minimum column width to prevent columns from becoming too small
const MIN_COLUMN_WIDTH = 50;

interface TableProps<T, G> {
    columns: Column<T>[];
    renderIconName?: (item: T) => string;
    renderGroup: (group: G) => ReactNode;
    renderCell: (column: Column<T>, itemData: T) => ReactNode;
    store: TableStore<T, G>;
    getResultStatus?: (item: T) => ResultStatus;
    onColumnReorder?: (fromIndex: number, toIndex: number) => void;
}
@observer export class Table<T, G> extends Component<TableProps<T, G>> {
    // Drag state for column reordering
    @observable private dragColumnIndex: number | null = null;
    @observable private dragOverColumnIndex: number | null = null;

    @computed get gridTemplateColumns() {
        const {columns, renderIconName} = this.props;
        return [
            '34px', // Left margin. Aligns with tabs left margin (22px) + group chevron (12px).
            // Dedicated icon column (only if icons are rendered)
            ...(renderIconName ? ['22px'] : []),
            // Variable number of columns set to user-desired width.
            ...columns.map((col) => `${Math.max(col.width.get(), MIN_COLUMN_WIDTH)}px`),
            '1fr', // Fill remaining space so the the selection/hover highlight doesn't look funny.
        ].join(' ');
    }

    @action.bound private onDragStart(e: React.DragEvent<HTMLDivElement>, index: number) {
        this.dragColumnIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    }

    @action.bound private onDragOver(e: React.DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.dragOverColumnIndex = index;
    }

    @action.bound private onDragLeave() {
        this.dragOverColumnIndex = null;
    }

    @action.bound private onDrop(e: React.DragEvent<HTMLDivElement>, toIndex: number) {
        e.preventDefault();
        const fromIndex = this.dragColumnIndex;
        if (fromIndex !== null && fromIndex !== toIndex && this.props.onColumnReorder) {
            this.props.onColumnReorder(fromIndex, toIndex);
        }
        this.dragColumnIndex = null;
        this.dragOverColumnIndex = null;
    }

    @action.bound private onDragEnd() {
        this.dragColumnIndex = null;
        this.dragOverColumnIndex = null;
    }

    private TableItem = memo<{ isLineThrough: boolean, isSelected: boolean, item: RowItem<T>, gridTemplateColumns: string, menuContext: Record<string, string> | undefined, resultStatus: ResultStatus, columns: Column<T>[] }>(props => {
        const { store, renderIconName, renderCell } = this.props;
        const { isLineThrough, isSelected, item, gridTemplateColumns, menuContext, resultStatus, columns } = props;

        // Determine CSS class based on result status
        const statusClass = resultStatus === 'true-positive' ? 'svTruePositive'
            : resultStatus === 'false-positive' ? 'svFalsePositive'
                : '';

        return <div className={css('svTableRow', 'svTableRowItem', isLineThrough && 'svLineThrough', isSelected && 'svItemSelected', statusClass)} style={{ gridTemplateColumns }}
            data-vscode-context={JSON.stringify(menuContext)}
            ref={ele => { // TODO: ForwardRef for Group
                if (!isSelected || !ele) return;
                setTimeout(() => ele.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); // requestAnimationFrame not working.
            }}
            onClick={e => {
                e.stopPropagation();
                store.selection.set(item);
            }}>
            <div></div>
            {renderIconName && <div className="svTableCell svIconCell"><Icon name={renderIconName(item.item)} /></div>}
            {columns.map((col, i) => <Hi key={col.name} className="svTableCell"
                style={i === columns.length - 1 ? { gridColumn: 'auto / span 2' } : {}}>
                {renderCell(col, item.item)}
            </Hi>)}
        </div>;
    })

    render() {
        const {TableItem, dragColumnIndex, dragOverColumnIndex} = this;
        const {columns, store, renderGroup, children, getResultStatus, onColumnReorder} = this.props;
        const {rows, selection} = store;
        return !rows.length
            ? children // Zero data.
            : <div className="svTable" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
                <div className="svTableHeader" style={{ gridTemplateColumns: this.gridTemplateColumns }}>
                    <div></div>
                    {this.props.renderIconName && <div></div>}
                    {columns.map((col, colIndex) => <div key={col.name} tabIndex={0}
                        className={css(
                            'svTableCell',
                            onColumnReorder && 'svDraggable',
                            dragColumnIndex === colIndex && 'svDragging',
                            dragOverColumnIndex === colIndex && 'svDragOver'
                        )}
                        draggable={!!onColumnReorder}
                        onDragStart={e => this.onDragStart(e, colIndex)}
                        onDragOver={e => this.onDragOver(e, colIndex)}
                        onDragLeave={this.onDragLeave}
                        onDrop={e => this.onDrop(e, colIndex)}
                        onDragEnd={this.onDragEnd}
                        onClick={action(() => store.toggleSort(col.name))}>
                        {col.name}{/* No spacing */}
                        {store.sortColumn === col.name && <Icon title="Sort" name={store.sortDir} />}
                        <ResizeHandle size={col.width} horizontal minSize={MIN_COLUMN_WIDTH} />
                    </div>)}
                </div>
                <div tabIndex={0} className={css('svTableBody', selection.get() && 'svSelected')} onKeyDown={this.onKeyDown}>
                    {rows.map(row => {
                        const isSelected = selection.get() === row;
                        if (row instanceof RowGroup) {
                            return <Hi key={row.key} className={css('svTableRow', 'svTableRowGroup', 'svTableCell', isSelected && 'svItemSelected')}
                                onClick={e => {
                                    e.stopPropagation();
                                    selection.set(row);
                                    row.expanded = !row.expanded;
                                }}>
                                <div style={{ width: 6 }}></div>
                                <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} />
                                {renderGroup(row.title)}
                                <Badge text={row.itemsFiltered.length} />
                            </Hi>;
                        }
                        if (row instanceof RowItem) {
                            // Must evaluate isLineThrough outside of <TableItem /> so the function component knows to update.
                            const resultStatus = getResultStatus ? getResultStatus(row.item) : 'unchecked';
                            return <TableItem key={row.key}
                                isLineThrough={store.isLineThrough(row.item)}
                                isSelected={isSelected}
                                item={row}
                                gridTemplateColumns={this.gridTemplateColumns}
                                menuContext={store.menuContext(row.item)}
                                resultStatus={resultStatus}
                                columns={columns} />;
                        }
                        return undefined; // Closed system: No other types expected.
                    })}
                </div>
            </div>;
    }

    @action.bound private onKeyDown(e: KeyboardEvent<Element>) {
        const {store} = this.props;
        const {rows, selection} = store;
        const index = rows.indexOf(selection.get()); // Rows
        const handlers = {
            ArrowUp: () => selection.set(rows[index - 1] ?? rows[index] ?? rows[0]),
            ArrowDown: () => selection.set(rows[index + 1] ?? rows[index]),
            Escape: () => selection.set(undefined)
        } as Record<string, () => void>;
        const handler = handlers[e.key];
        if (handler) {
            e.stopPropagation();
            e.preventDefault(); // Prevent scrolling.
            handler();
        }
    }
}
