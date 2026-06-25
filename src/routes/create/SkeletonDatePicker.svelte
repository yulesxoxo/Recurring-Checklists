<script lang="ts">
	import { CalendarDays } from '@lucide/svelte';
	import { DatePicker, parseDate, Portal, type DateValue } from '@skeletonlabs/skeleton-svelte';

	let {
		label,
		value,
		min,
		onChange
	}: {
		label: string;
		value: string;
		min?: string;
		onChange: (value: string) => void;
	} = $props();

	let pickerValue = $derived(dateValues(value));
	let minValue = $derived(dateValue(min));

	function updateDate(details: { value: DateValue[] }): void {
		const selected = details.value[0]?.toString();
		if (selected) onChange(selected);
	}

	function dateValues(date: string): DateValue[] {
		const parsed = dateValue(date);
		return parsed ? [parsed] : [];
	}

	function dateValue(date: string | undefined): DateValue | undefined {
		if (!date) return undefined;

		try {
			return parseDate(date);
		} catch {
			return undefined;
		}
	}
</script>

<DatePicker value={pickerValue} min={minValue} onValueChange={updateDate} openOnClick>
	<DatePicker.Label class="label-text">{label}</DatePicker.Label>
	<DatePicker.Control class="grid grid-cols-[minmax(0,1fr)_auto]">
		<DatePicker.Input class="input rounded-r-none" placeholder="mm/dd/yyyy" />
		<DatePicker.Trigger class="btn-icon preset-tonal-surface rounded-l-none border-l-0">
			<CalendarDays size={18} aria-hidden="true" />
		</DatePicker.Trigger>
	</DatePicker.Control>
	<Portal>
		<DatePicker.Positioner>
			<DatePicker.Content>
				<DatePicker.View view="day">
					<DatePicker.Context>
						{#snippet children(datePicker)}
							<DatePicker.ViewControl>
								<DatePicker.PrevTrigger />
								<DatePicker.ViewTrigger>
									<DatePicker.RangeText />
								</DatePicker.ViewTrigger>
								<DatePicker.NextTrigger />
							</DatePicker.ViewControl>
							<DatePicker.Table>
								<DatePicker.TableHead>
									<DatePicker.TableRow>
										{#each datePicker().weekDays as weekDay, id (id)}
											<DatePicker.TableHeader>{weekDay.short}</DatePicker.TableHeader>
										{/each}
									</DatePicker.TableRow>
								</DatePicker.TableHead>
								<DatePicker.TableBody>
									{#each datePicker().weeks as week, id (id)}
										<DatePicker.TableRow>
											{#each week as day, dayId (dayId)}
												<DatePicker.TableCell value={day}>
													<DatePicker.TableCellTrigger>{day.day}</DatePicker.TableCellTrigger>
												</DatePicker.TableCell>
											{/each}
										</DatePicker.TableRow>
									{/each}
								</DatePicker.TableBody>
							</DatePicker.Table>
						{/snippet}
					</DatePicker.Context>
				</DatePicker.View>
				<DatePicker.View view="month">
					<DatePicker.Context>
						{#snippet children(datePicker)}
							<DatePicker.ViewControl>
								<DatePicker.PrevTrigger />
								<DatePicker.ViewTrigger>
									<DatePicker.RangeText />
								</DatePicker.ViewTrigger>
								<DatePicker.NextTrigger />
							</DatePicker.ViewControl>
							<DatePicker.Table>
								<DatePicker.TableBody>
									{#each datePicker().getMonthsGrid( { columns: 4, format: 'short' } ) as months, id (id)}
										<DatePicker.TableRow>
											{#each months as month, monthId (monthId)}
												<DatePicker.TableCell value={month.value}>
													<DatePicker.TableCellTrigger>{month.label}</DatePicker.TableCellTrigger>
												</DatePicker.TableCell>
											{/each}
										</DatePicker.TableRow>
									{/each}
								</DatePicker.TableBody>
							</DatePicker.Table>
						{/snippet}
					</DatePicker.Context>
				</DatePicker.View>
				<DatePicker.View view="year">
					<DatePicker.Context>
						{#snippet children(datePicker)}
							<DatePicker.ViewControl>
								<DatePicker.PrevTrigger />
								<DatePicker.ViewTrigger>
									<DatePicker.RangeText />
								</DatePicker.ViewTrigger>
								<DatePicker.NextTrigger />
							</DatePicker.ViewControl>
							<DatePicker.Table>
								<DatePicker.TableBody>
									{#each datePicker().getYearsGrid({ columns: 4 }) as years, id (id)}
										<DatePicker.TableRow>
											{#each years as year, yearId (yearId)}
												<DatePicker.TableCell value={year.value}>
													<DatePicker.TableCellTrigger>{year.label}</DatePicker.TableCellTrigger>
												</DatePicker.TableCell>
											{/each}
										</DatePicker.TableRow>
									{/each}
								</DatePicker.TableBody>
							</DatePicker.Table>
						{/snippet}
					</DatePicker.Context>
				</DatePicker.View>
			</DatePicker.Content>
		</DatePicker.Positioner>
	</Portal>
</DatePicker>
