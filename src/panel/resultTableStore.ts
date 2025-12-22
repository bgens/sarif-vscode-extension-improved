// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IObservableValue } from 'mobx';
import { Result } from 'sarif';
import { ResultStatus, ResultStatusMap, Visibility } from '../shared';
import { IndexStore } from './indexStore';
import { Column, Row, TableStore } from './tableStore';

export class ResultTableStore<G> extends TableStore<Result, G> {
    constructor(
        readonly groupName: string,
        readonly groupBy: (item: Result) => G | undefined,
        private readonly resultsSource: Pick<IndexStore, 'results' | 'resultsFixed' | 'resultStatuses' | 'dynamicColumns' | 'columnOrder' | 'setColumnOrder'>,
        readonly filtersSource: {
            keywords: string;
            filtersRow: Record<string, Record<string, Visibility>>;
            filtersColumn: Record<string, Record<string, Visibility>>;
        },
        readonly selection: IObservableValue<Row | undefined>) {
        super(
            groupBy,
            resultsSource,
            selection,
        );
        // Set default sort column - use first available column
        this.sortColumn = this.columnsOptional[0]?.name ?? 'Line';
    }

    // Columns
    private columnsPermanent: Column<Result>[] = [
    ]
    private columnsOptional = [
        new Column<Result>('Line', 50, result => result._region?.startLine?.toString() ?? '—', result => result._region?.startLine ?? 0),
        new Column<Result>('File', 250, result => result._relativeUri ?? ''),
        new Column<Result>('Status', 100, result => {
            const status = this.resultsSource.resultStatuses[JSON.stringify(result._id)];
            return status === 'true-positive' ? 'TP' : status === 'false-positive' ? 'FP' : '—';
        }),
        new Column<Result>('Message', 300, result => result._message ?? ''),
        new Column<Result>('Baseline', 100, result => result.baselineState ?? ''),
        new Column<Result>('Suppression', 100, result => result._suppression ?? ''),
        new Column<Result>('Rule', 220, result => `${result._rule?.name ?? '—'} ${result.ruleId ?? '—'}`),
    ]

    // Dynamic columns from SARIF properties
    @computed get dynamicPropertyColumns(): Column<Result>[] {
        return this.resultsSource.dynamicColumns.map(key =>
            new Column<Result>(key, 150, result => {
                const value = result.properties?.[key];
                if (value === null || value === undefined) return '—';
                if (typeof value === 'object') return JSON.stringify(value);
                return String(value);
            })
        );
    }

    get columns() {
        return [...this.columnsPermanent, ...this.columnsOptional, ...this.dynamicPropertyColumns];
    }
    @computed get visibleColumns() {
        const {filtersColumn} = this.filtersSource;
        const optionalColumnNames = Object.entries(filtersColumn.Columns)
            .filter(([_, state]) => state)
            .map(([name, ]) => name);
        const unorderedColumns = [
            ...this.columnsPermanent.filter(col => col.name !== this.groupName),
            ...this.columnsOptional.filter(col => optionalColumnNames.includes(col.name)),
            ...this.dynamicPropertyColumns.filter(col => optionalColumnNames.includes(col.name))
        ];

        // Apply custom column order if set
        const { columnOrder } = this.resultsSource;
        if (columnOrder && columnOrder.length > 0) {
            const orderedColumns: Column<Result>[] = [];
            // First add columns in the specified order
            for (const colName of columnOrder) {
                const col = unorderedColumns.find(c => c.name === colName);
                if (col) orderedColumns.push(col);
            }
            // Then add any columns not in the order list
            for (const col of unorderedColumns) {
                if (!orderedColumns.includes(col)) orderedColumns.push(col);
            }
            return orderedColumns;
        }
        return unorderedColumns;
    }

    // Method to reorder columns via drag and drop
    moveColumn(fromIndex: number, toIndex: number) {
        const columns = this.visibleColumns.map(c => c.name);
        const [moved] = columns.splice(fromIndex, 1);
        columns.splice(toIndex, 0, moved);
        this.resultsSource.setColumnOrder(columns);
    }

    protected get filter() {
        const {keywords, filtersRow} = this.filtersSource;
        const {columns} = this;
        const mapToList = (record: Record<string, Visibility>) => Object.entries(record)
            .filter(([, value]) => value)
            .map(([label,]) => label.toLowerCase());

        const levels = mapToList(filtersRow.Level);
        const baselines = mapToList(filtersRow.Baseline);
        const suppressions = mapToList(filtersRow.Suppression);
        const filterKeywords = keywords.toLowerCase().split(/\s+/).filter(part => part);

        return (result: Result) => {
            if (!levels.includes(result.level ?? '')) return false;
            if (!baselines.includes(result.baselineState ?? '')) return false;
            if (!suppressions.includes(result._suppression ?? '')) return false;
            return columns.some(col => {
                const isMatch = (field: string, keywords: string[]) => !keywords.length || keywords.some(keyword => field.includes(keyword));
                const {toString} = col;
                const field = toString(result).toLowerCase();
                return isMatch(field, filterKeywords);
            });
        };
    }

    public isLineThrough(result: Result): boolean {
        return this.resultsSource.resultsFixed.includes(JSON.stringify(result._id));
    }

    public getResultStatus(result: Result): ResultStatus {
        return this.resultsSource.resultStatuses[JSON.stringify(result._id)] || 'unchecked';
    }

    public menuContext(result: Result): Record<string, string> | undefined {
        // If no alertNumber, then don't show the context menu (which contains the Dismiss Alert commands).
        if (!result.properties?.['github/alertNumber']) return undefined;

        return { webviewSection: 'isGithubAlert', resultId: JSON.stringify(result._id) };
    }
}
