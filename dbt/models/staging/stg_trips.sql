select
    cast(trip_id as int)             as trip_id,
    route,
    cast(fare as decimal(10, 2))     as fare,
    cast(distance_nm as double)      as distance_nm,
    cast(completed as boolean)       as completed,
    cast(sailed_on as date)          as sailed_on
from {{ ref('trips') }}
