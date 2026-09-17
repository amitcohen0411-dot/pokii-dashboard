-- USD/ILS rate, used to convert TCGplayer market prices (USD) into
-- estimated_value (ILS) when pricing Pokémon cards from real market data.
insert into app_settings (key, value) values ('usd_ils_rate', '3.03')
on conflict (key) do update set value = excluded.value;
