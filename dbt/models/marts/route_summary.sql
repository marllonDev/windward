select
    route,
    count(*)                                          as trips,
    sum(case when completed then 1 else 0 end)        as completed_trips,
    round(sum(fare), 2)                               as total_fare,
    round(avg(distance_nm), 2)                        as avg_distance_nm
from {{ ref('stg_trips') }}
group by route
